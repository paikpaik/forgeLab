import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { InjectDataSource } from "@paikpaik/node-forge/database/nestjs";
import type { DataSource } from "typeorm";
import { LessThanOrEqual } from "typeorm";
import { AuctionEntity } from "./entities/auction.entity";
import { AuctionService } from "./auction.service";
import { AUCTION_CLOSE_INTERVAL_MS } from "../shared/constants";

// waiting-room 다중 인스턴스 검증에서 얻은 교훈 — 여러 인스턴스가 조율 없이 같은 폴러를
// 돌리면 집계 지표/로그가 중복될 수 있다는 걸 실측으로 확인했다. 여기서는 AuctionService.
// closeAuction()이 status='LIVE' 조건부 UPDATE의 영향 행 수로 "내가 실제로 커밋했는지"를
// 판단하므로, 여러 인스턴스가 동시에 같은 마감 경매를 집어도 정확히 한 인스턴스만 종료
// 처리(로그/pub-sub 방송 포함)를 완료한다.
@Injectable()
export class AuctionCloserService {
  private readonly logger = new Logger(AuctionCloserService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auctionService: AuctionService,
  ) {}

  @Interval(AUCTION_CLOSE_INTERVAL_MS)
  async tick(): Promise<void> {
    const now = new Date().toISOString();
    const candidates = await this.dataSource.getRepository(AuctionEntity).find({
      where: { status: "LIVE", endsAt: LessThanOrEqual(now) },
    });

    for (const auction of candidates) {
      try {
        await this.auctionService.closeAuction(auction.id);
      } catch (error) {
        this.logger.error(`auction=${auction.id} 종료 처리 중 예외 (다음 tick에 재시도): ${(error as Error).message}`);
      }
    }
  }
}
