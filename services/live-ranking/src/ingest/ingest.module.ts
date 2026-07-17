import { Module } from "@nestjs/common";
import { IngestController } from "./ingest.controller";
import { ScoreEventProducerService } from "./score-event-producer.service";

@Module({
  controllers: [IngestController],
  providers: [ScoreEventProducerService],
})
export class IngestModule {}
