import { Module } from "@nestjs/common";
import { RankingController } from "./ranking.controller";
import { RankingService } from "./ranking.service";
import { RankingMetrics } from "./ranking.metrics";
import { RedisIdempotencyStore } from "./redis-idempotency-store";
import { ScoreEventConsumer } from "./score-event.consumer";
import { DlqController } from "./dlq.controller";
import { DlqLogService } from "./dlq-log.service";
import { ScoreEventDlqConsumer } from "./score-event-dlq.consumer";

@Module({
  controllers: [RankingController, DlqController],
  providers: [
    RankingService,
    RankingMetrics,
    RedisIdempotencyStore,
    ScoreEventConsumer,
    DlqLogService,
    ScoreEventDlqConsumer,
  ],
})
export class AggregatorModule {}
