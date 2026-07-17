import { Controller, Delete, Get, Param, Query, UseInterceptors } from "@nestjs/common";
import { ResponseInterceptor } from "@paikpaik/node-forge/response/nestjs";
import { LeaderboardQueryDto } from "./dto/leaderboard-query.dto";
import { RankingService } from "./ranking.service";
import type { LeaderboardEntry, UserRank } from "./ranking.service";

@Controller("leaderboards/:leaderboardId")
@UseInterceptors(ResponseInterceptor)
export class RankingController {
  constructor(private readonly rankingService: RankingService) {}

  @Get("top")
  getTop(
    @Param("leaderboardId") leaderboardId: string,
    @Query() query: LeaderboardQueryDto,
  ): Promise<LeaderboardEntry[]> {
    return this.rankingService.getTop(leaderboardId, query.limit ?? 20);
  }

  @Get("users/:userId")
  getUserRank(
    @Param("leaderboardId") leaderboardId: string,
    @Param("userId") userId: string,
  ): Promise<UserRank> {
    return this.rankingService.getUserRank(leaderboardId, userId);
  }

  @Delete()
  reset(@Param("leaderboardId") leaderboardId: string): Promise<void> {
    return this.rankingService.reset(leaderboardId);
  }
}
