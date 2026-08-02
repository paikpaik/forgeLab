import { Module } from "@nestjs/common";
import { AdminEventsModule } from "@paikpaik/node-forge/events/nestjs";
import { RankingController } from "./ranking.controller";
import { RankingService } from "./ranking.service";
import { RankingMetrics } from "./ranking.metrics";
import { ScoreEventConsumer } from "./score-event.consumer";
import { DlqController } from "./dlq.controller";
import { DlqLogService } from "./dlq-log.service";
import { ScoreEventDlqConsumer } from "./score-event-dlq.consumer";

@Module({
  imports: [AdminEventsModule.forRoot({ path: "admin/logs" })],
  controllers: [RankingController, DlqController],
  providers: [RankingService, RankingMetrics, ScoreEventConsumer, DlqLogService, ScoreEventDlqConsumer],
})
export class AggregatorModule {}
