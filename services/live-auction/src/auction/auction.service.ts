import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@paikpaik/node-forge/database/nestjs";
import type { DataSource } from "typeorm";
import { InjectRedis } from "@paikpaik/node-forge/redis/nestjs";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import { ForgeBizError } from "@paikpaik/node-forge/core";
import { AdminEventBus } from "@paikpaik/node-forge/events";
import { ADMIN_EVENT_BUS } from "@paikpaik/node-forge/events/nestjs";
import { AuctionEntity } from "./entities/auction.entity";
import { BidEntity } from "./entities/bid.entity";
import type { CreateAuctionDto } from "./dto/create-auction.dto";
import {
  auctionCurrentKey,
  auctionLockKey,
  AUCTION_EVENTS_CHANNEL,
  BID_LOCK_RETRIES,
  BID_LOCK_RETRY_DELAY_MS,
  BID_LOCK_TTL_SECONDS,
} from "../shared/constants";
import type { AdminLogEvent } from "../shared/admin-log-event";

export interface AuctionView {
  found: boolean;
  id: string;
  title: string;
  description: string;
  startingPrice: number;
  minIncrement: number;
  status: string;
  currentHighestBid: number;
  currentHighestBidderId: string | null;
  endsAt: string;
  winnerId: string | null;
  finalPrice: number | null;
}

function toView(auction: AuctionEntity): AuctionView {
  return {
    found: true,
    id: auction.id,
    title: auction.title,
    description: auction.description,
    startingPrice: auction.startingPrice,
    minIncrement: auction.minIncrement,
    status: auction.status,
    currentHighestBid: auction.currentHighestBid,
    currentHighestBidderId: auction.currentHighestBidderId,
    endsAt: auction.endsAt,
    winnerId: auction.winnerId,
    finalPrice: auction.finalPrice,
  };
}

@Injectable()
export class AuctionService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRedis() private readonly redis: ForgeRedisClient,
    @Inject(ADMIN_EVENT_BUS) private readonly adminEvents: AdminEventBus<AdminLogEvent>,
  ) {}

  async createAuction(dto: CreateAuctionDto): Promise<AuctionView> {
    const id = randomUUID();
    const endsAt = new Date(Date.now() + dto.durationSeconds * 1000).toISOString();
    const auction = await this.dataSource.getRepository(AuctionEntity).save({
      id,
      title: dto.title,
      description: dto.description,
      startingPrice: dto.startingPrice,
      minIncrement: dto.minIncrement,
      status: "LIVE",
      currentHighestBid: dto.startingPrice,
      currentHighestBidderId: null,
      endsAt,
      winnerId: null,
      finalPrice: null,
    });

    await this.mirrorToRedis(auction);
    this.adminEvents.emit({ message: `경매 시작 — ${dto.title} (시작가 ${dto.startingPrice}원)`, at: new Date().toISOString() });
    return toView(auction);
  }

  async listLive(): Promise<AuctionView[]> {
    const auctions = await this.dataSource.getRepository(AuctionEntity).find({
      where: { status: "LIVE" },
      order: { createdAt: "DESC" },
    });
    return auctions.map(toView);
  }

  // 빠른 조회는 Redis 미러를 먼저 본다 — 캐시 미스면(TTL 없음, 이론상 안 생기지만 방어적으로)
  // Postgres로 폴백하고 다시 미러링해둔다.
  async getState(auctionId: string): Promise<AuctionView | null> {
    const cached = await this.redis.get<AuctionView>(auctionCurrentKey(auctionId));
    if (cached) return cached;

    const auction = await this.dataSource.getRepository(AuctionEntity).findOneBy({ id: auctionId });
    if (!auction) return null;
    await this.mirrorToRedis(auction);
    return toView(auction);
  }

  async listBids(auctionId: string): Promise<BidEntity[]> {
    return this.dataSource.getRepository(BidEntity).find({
      where: { auctionId },
      order: { placedAt: "DESC" },
      take: 50,
    });
  }

  // 이 실험의 핵심 — "현재 최고가 조회 → 검증 → 갱신"을 락 없이 하면, 동시에 들어온 두
  // 입찰이 같은 현재가를 보고 각자 통과시킨 뒤 나중에 쓴 쪽이 이겨버려서(lost update) 더
  // 낮은 입찰이 최종적으로 남을 수 있다. withLock으로 이 구간 전체를 원자화한다.
  async placeBid(auctionId: string, bidderId: string, amount: number): Promise<{ accepted: boolean; currentHighestBid: number }> {
    return this.redis.withLock(
      auctionLockKey(auctionId),
      BID_LOCK_TTL_SECONDS,
      async () => {
        const repo = this.dataSource.getRepository(AuctionEntity);
        const auction = await repo.findOneBy({ id: auctionId });
        if (!auction) throw new ForgeBizError("E9404", "경매를 찾을 수 없습니다");

        // 존재하는 경매에 대한 거절은 REJECTED 입찰로 남긴다 — 동시에 들어온 낮은 입찰이
        // withLock 순서상 나중에 검증돼서 거절되는 경우도 여기 해당(사용자가 지적한 케이스).
        const recordRejected = (reason: string) =>
          this.dataSource.getRepository(BidEntity).save({
            id: randomUUID(),
            auctionId,
            bidderId,
            amount,
            status: "REJECTED" as const,
            rejectionReason: reason,
          });

        if (auction.status !== "LIVE" || auction.endsAt <= new Date().toISOString()) {
          const reason = "이미 종료된 경매입니다";
          await recordRejected(reason);
          throw new ForgeBizError("E9400", reason);
        }
        const minAcceptable = auction.currentHighestBid + auction.minIncrement;
        if (amount < minAcceptable) {
          const reason = `최소 ${minAcceptable}원 이상 입찰해야 합니다`;
          await recordRejected(reason);
          throw new ForgeBizError("E9409", reason);
        }

        await this.dataSource.transaction(async (manager) => {
          await manager.save(BidEntity, { id: randomUUID(), auctionId, bidderId, amount, status: "ACCEPTED", rejectionReason: null });
          await manager.update(AuctionEntity, auctionId, {
            currentHighestBid: amount,
            currentHighestBidderId: bidderId,
          });
        });

        const updated = await repo.findOneBy({ id: auctionId });
        await this.mirrorToRedis(updated!);
        await this.redis.publish(AUCTION_EVENTS_CHANNEL, {
          type: "bid-placed",
          auctionId,
          data: { bidderId, amount, at: new Date().toISOString() },
        });
        this.adminEvents.emit({ message: `입찰 — ${bidderId}가 ${amount}원 (경매 ${auctionId.slice(0, 8)}…)`, at: new Date().toISOString() });

        return { accepted: true, currentHighestBid: amount };
      },
      { retries: BID_LOCK_RETRIES, retryDelay: BID_LOCK_RETRY_DELAY_MS },
    );
  }

  // 테스트 도구의 "강제 종료" 버튼과 AuctionCloserService(폴러)가 공유하는 종료 로직.
  // status='LIVE' 조건부 UPDATE로 커밋해서, 여러 인스턴스가 동시에 같은 경매를 종료
  // 시도해도 정확히 한 번만 처리된다(waiting-room 다중 인스턴스 검증에서 얻은 교훈 반영).
  async closeAuction(auctionId: string): Promise<boolean> {
    const repo = this.dataSource.getRepository(AuctionEntity);
    const auction = await repo.findOneBy({ id: auctionId });
    if (!auction || auction.status !== "LIVE") return false;

    const result = await repo.update(
      { id: auctionId, status: "LIVE" },
      { status: "ENDED", winnerId: auction.currentHighestBidderId, finalPrice: auction.currentHighestBid },
    );
    if ((result.affected ?? 0) === 0) return false; // 다른 인스턴스가 먼저 처리함

    const updated = await repo.findOneBy({ id: auctionId });
    await this.mirrorToRedis(updated!);
    await this.redis.publish(AUCTION_EVENTS_CHANNEL, {
      type: "auction-ended",
      auctionId,
      data: { winnerId: updated!.winnerId, finalPrice: updated!.finalPrice },
    });
    this.adminEvents.emit({
      message: `경매 종료 — ${auction.title} 낙찰자 ${updated!.winnerId ?? "없음"} (${updated!.finalPrice}원)`,
      at: new Date().toISOString(),
    });
    return true;
  }

  private async mirrorToRedis(auction: AuctionEntity): Promise<void> {
    await this.redis.set(auctionCurrentKey(auction.id), toView(auction));
  }
}
