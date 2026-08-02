import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { RedisModule } from "@paikpaik/node-forge/redis/nestjs";
import { AdminEventsModule } from "@paikpaik/node-forge/events/nestjs";
import { AuctionController } from "./auction.controller";
import { AdminAuctionController } from "./admin.controller";
import { AuctionService } from "./auction.service";
import { AuctionGateway } from "./auction.gateway";
import { AuctionCloserService } from "./auction-closer.service";

const redisOptions = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

@Module({
  imports: [
    ScheduleModule.forRoot(),
    // RedisModule/AdminEventsModule은 이 모듈이 실제로 컨트롤러/서비스를 갖고 있는 feature
    // 모듈이라 여기서 등록해야 DI가 닿는다(msa-checkout에서 루트 앱모듈에 뒀다가 형제
    // 모듈이라 못 찾은 실수를 이번엔 처음부터 피함).
    RedisModule.forRoot(redisOptions),
    AdminEventsModule.forRoot({ path: "admin/logs" }),
  ],
  controllers: [AuctionController, AdminAuctionController],
  providers: [AuctionService, AuctionGateway, AuctionCloserService],
})
export class AuctionModule {}
