import { Injectable } from "@nestjs/common";
import { InjectRedis } from "@paikpaik/node-forge/redis/nestjs";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import { leaderboardKey } from "../shared/constants";
import { RankingMetrics } from "./ranking.metrics";

export interface LeaderboardEntry {
  userId: string;
  score: number;
  rank: number;
}

export interface UserRank {
  rank: number | null;
  score: number | null;
}

@Injectable()
export class RankingService {
  constructor(
    @InjectRedis() private readonly redis: ForgeRedisClient,
    private readonly metrics: RankingMetrics,
  ) {}

  async applyDelta(leaderboardId: string, userId: string, delta: number): Promise<number> {
    const score = await this.redis.zincrby(leaderboardKey(leaderboardId), userId, delta);
    this.metrics.scoreEventsApplied.inc({ leaderboardId });
    return score;
  }

  async getTop(leaderboardId: string, limit: number): Promise<LeaderboardEntry[]> {
    const entries = await this.redis.getTopN(leaderboardKey(leaderboardId), limit);
    return entries.map((entry) => ({ userId: entry.member, score: entry.score, rank: entry.rank }));
  }

  async getUserRank(leaderboardId: string, userId: string): Promise<UserRank> {
    return this.redis.getRankAndScore(leaderboardKey(leaderboardId), userId);
  }

  async reset(leaderboardId: string): Promise<void> {
    await this.redis.del(leaderboardKey(leaderboardId));
  }
}
