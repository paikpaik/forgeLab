import { Module } from "@nestjs/common";
import { RankingController } from "./ranking.controller";
import { RankingService } from "./ranking.service";
import { RankingMetrics } from "./ranking.metrics";
import { RedisIdempotencyStore } from "./redis-idempotency-store";
import { ScoreEventConsumer } from "./score-event.consumer";

@Module({
  controllers: [RankingController],
  providers: [RankingService, RankingMetrics, RedisIdempotencyStore, ScoreEventConsumer],
})
export class AggregatorModule {}
