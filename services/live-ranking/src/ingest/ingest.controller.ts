import { Body, Controller, Param, Post, UseInterceptors } from "@nestjs/common";
import { ResponseInterceptor } from "@paikpaik/node-forge/response/nestjs";
import { ScoreEventProducerService } from "./score-event-producer.service";
import { SubmitScoreEventDto } from "./dto/submit-score-event.dto";

@Controller("leaderboards/:leaderboardId/events")
@UseInterceptors(ResponseInterceptor)
export class IngestController {
  constructor(private readonly producer: ScoreEventProducerService) {}

  @Post()
  submit(
    @Param("leaderboardId") leaderboardId: string,
    @Body() dto: SubmitScoreEventDto,
  ): Promise<{ eventId: string }> {
    return this.producer.submit(leaderboardId, dto.userId, dto.delta, dto.eventId);
  }
}
