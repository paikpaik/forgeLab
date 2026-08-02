import { describe, it, expect, afterEach } from "vitest";
import type { DataSource } from "typeorm";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import type { AdminEventBus } from "@paikpaik/node-forge/events";
import { createTestDataSource } from "../test-utils/create-test-data-source";
import { FakeRedisClient } from "../test-utils/fake-redis-client";
import { AuctionService } from "./auction.service";
import type { AdminLogEvent } from "../shared/admin-log-event";

let dataSource: DataSource;

afterEach(async () => {
  if (dataSource?.isInitialized) await dataSource.destroy();
});

function createFakeAdminEvents(): AdminEventBus<AdminLogEvent> {
  return { emit: () => {} } as unknown as AdminEventBus<AdminLogEvent>;
}

async function setup() {
  dataSource = await createTestDataSource();
  const redis = new FakeRedisClient();
  const service = new AuctionService(dataSource, redis as unknown as ForgeRedisClient, createFakeAdminEvents());
  return { service, redis };
}

describe("AuctionService.createAuction / getState", () => {
  it("경매를 생성하면 startingPrice가 currentHighestBid의 초기값이 된다", async () => {
    const { service } = await setup();
    const auction = await service.createAuction({
      title: "빈티지 시계",
      description: "설명",
      startingPrice: 100,
      minIncrement: 10,
      durationSeconds: 60,
    });

    expect(auction.currentHighestBid).toBe(100);
    expect(auction.currentHighestBidderId).toBeNull();
    expect(auction.status).toBe("LIVE");
  });

  it("getState는 Redis 미러를 우선 반환한다", async () => {
    const { service } = await setup();
    const auction = await service.createAuction({
      title: "그림",
      description: "설명",
      startingPrice: 50,
      minIncrement: 5,
      durationSeconds: 60,
    });

    const state = await service.getState(auction.id);
    expect(state).toEqual(auction);
  });
});

describe("AuctionService.placeBid", () => {
  it("최소 증분 이상이면 입찰이 반영된다", async () => {
    const { service } = await setup();
    const auction = await service.createAuction({
      title: "아이템",
      description: "설명",
      startingPrice: 100,
      minIncrement: 10,
      durationSeconds: 60,
    });

    const result = await service.placeBid(auction.id, "alice", 110);
    expect(result).toEqual({ accepted: true, currentHighestBid: 110 });

    const state = await service.getState(auction.id);
    expect(state?.currentHighestBid).toBe(110);
    expect(state?.currentHighestBidderId).toBe("alice");
  });

  it("최소 증분보다 낮은 입찰은 거부되고, 거부된 입찰도 이력에 REJECTED로 남는다", async () => {
    const { service } = await setup();
    const auction = await service.createAuction({
      title: "아이템",
      description: "설명",
      startingPrice: 100,
      minIncrement: 10,
      durationSeconds: 60,
    });

    await expect(service.placeBid(auction.id, "bob", 105)).rejects.toThrow();

    const bids = await service.listBids(auction.id);
    expect(bids).toHaveLength(1);
    expect(bids[0]).toMatchObject({ bidderId: "bob", amount: 105, status: "REJECTED" });
    expect(bids[0].rejectionReason).toContain("최소");
  });

  it("종료된 경매에는 입찰할 수 없다", async () => {
    const { service } = await setup();
    const auction = await service.createAuction({
      title: "아이템",
      description: "설명",
      startingPrice: 100,
      minIncrement: 10,
      durationSeconds: 60,
    });
    await service.closeAuction(auction.id);

    await expect(service.placeBid(auction.id, "carol", 200)).rejects.toThrow();
  });

  // 이 실험의 핵심 검증 — withLock 없이 "조회→검증→갱신"을 하면 동시 입찰 중 나중에 커밋된
  // 쪽이 먼저 커밋된 쪽을 덮어써서, 더 낮은 입찰이 최종 상태로 남는 lost update가 생길 수
  // 있다. 두 입찰(150, 120)을 동시에 쏴도 실행 순서와 무관하게 항상 더 높은 150이 최종
  // 상태로 수렴해야 한다(withLock이 두 처리를 직렬화하기 때문).
  it("동시에 들어온 두 입찰 중 항상 더 높은 금액이 최종 상태로 수렴한다", async () => {
    const { service } = await setup();
    const auction = await service.createAuction({
      title: "경쟁 테스트 아이템",
      description: "설명",
      startingPrice: 100,
      minIncrement: 10,
      durationSeconds: 60,
    });

    await Promise.allSettled([
      service.placeBid(auction.id, "high-bidder", 150),
      service.placeBid(auction.id, "low-bidder", 120),
    ]);

    const state = await service.getState(auction.id);
    expect(state?.currentHighestBid).toBe(150);
    expect(state?.currentHighestBidderId).toBe("high-bidder");

    // 진 입찰(120)도 사라지지 않고 REJECTED로 이력에 남아야 한다 — 사용자가 지적한 케이스.
    const bids = await service.listBids(auction.id);
    const losing = bids.find((b) => b.bidderId === "low-bidder");
    expect(losing?.status).toBe("REJECTED");
    const winning = bids.find((b) => b.bidderId === "high-bidder");
    expect(winning?.status).toBe("ACCEPTED");
  });
});

describe("AuctionService.closeAuction", () => {
  it("LIVE 경매를 종료하면 winnerId/finalPrice가 현재 최고 입찰로 확정된다", async () => {
    const { service } = await setup();
    const auction = await service.createAuction({
      title: "아이템",
      description: "설명",
      startingPrice: 100,
      minIncrement: 10,
      durationSeconds: 60,
    });
    await service.placeBid(auction.id, "winner", 130);

    const ended = await service.closeAuction(auction.id);
    expect(ended).toBe(true);

    const state = await service.getState(auction.id);
    expect(state?.status).toBe("ENDED");
    expect(state?.winnerId).toBe("winner");
    expect(state?.finalPrice).toBe(130);
  });

  // 다중 인스턴스에서 같은 경매를 동시에 종료 시도해도 정확히 한 번만 커밋돼야 한다
  // (waiting-room 다중 인스턴스 검증에서 얻은 교훈을 여기선 설계 단계부터 반영).
  it("이미 종료된 경매를 다시 종료하려 하면 false를 반환한다(중복 커밋 방지)", async () => {
    const { service } = await setup();
    const auction = await service.createAuction({
      title: "아이템",
      description: "설명",
      startingPrice: 100,
      minIncrement: 10,
      durationSeconds: 60,
    });

    const firstAttempt = await service.closeAuction(auction.id);
    const secondAttempt = await service.closeAuction(auction.id);

    expect(firstAttempt).toBe(true);
    expect(secondAttempt).toBe(false);
  });
});
