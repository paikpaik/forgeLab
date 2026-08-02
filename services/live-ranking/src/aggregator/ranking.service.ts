import { Inject, Injectable } from "@nestjs/common";
import { InjectRedis } from "@paikpaik/node-forge/redis/nestjs";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import { AdminEventBus } from "@paikpaik/node-forge/events";
import { ADMIN_EVENT_BUS } from "@paikpaik/node-forge/events/nestjs";
import { IDEMPOTENCY_TTL_SECONDS, idempotencyKey, leaderboardKey } from "../shared/constants";
import { RankingMetrics } from "./ranking.metrics";
import type { AdminLogEvent } from "./admin-log-event";

// claim(선점)과 이펙트(zincrby)를 한 Redis 호출로 묶는다 — 둘을 분리하면(kafka-forge의
// idempotencyStore.claim → 핸들러가 별도로 effect 실행) 그 사이에 프로세스가 죽었을 때
// "선점은 됐는데 이펙트는 반영 안 된" 상태가 영구히 남는다(claim의 락은 그대로 유지되니
// 재배달돼도 "이미 처리됨"으로 스킵되어 다시는 반영될 기회가 없음 — 2026-08-01 실제
// docker kill로 재현 확인, 자세한 내용은 ARCHITECTURE.md 참고). Lua 스크립트는 Redis가
// 통째로 원자 실행하므로, 이 둘 사이에 "일부만 된" 중간 상태 자체가 생길 수 없다.
const APPLY_DELTA_ONCE_SCRIPT = `
if redis.call("SET", KEYS[1], "1", "NX", "EX", ARGV[1]) then
  local newScore = redis.call("ZINCRBY", KEYS[2], ARGV[3], ARGV[2])
  return {1, newScore}
else
  local currentScore = redis.call("ZSCORE", KEYS[2], ARGV[2])
  return {0, currentScore}
end
`;

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
    @Inject(ADMIN_EVENT_BUS) private readonly adminEvents: AdminEventBus<AdminLogEvent>,
  ) {}

  async applyDelta(leaderboardId: string, userId: string, delta: number): Promise<number> {
    const score = await this.redis.zincrby(leaderboardKey(leaderboardId), userId, delta);
    this.metrics.scoreEventsApplied.inc({ leaderboardId });
    this.adminEvents.emit({
      type: "applied",
      message: `${userId} 점수 반영 (${delta >= 0 ? "+" : ""}${delta} → ${score}점)`,
      at: new Date().toISOString(),
    });
    return score;
  }

  // score-event.consumer.ts가 이걸 쓴다 — kafka-forge의 idempotencyStore.claim을 거치지
  // 않고, claim+이펙트를 이 메서드 하나(원자적 Lua 호출)로 대체한다. eventId가 이미
  // 처리된 적 있으면(락이 이미 있으면) 아무 것도 바꾸지 않고 현재 점수만 반환한다.
  async applyDeltaOnce(
    leaderboardId: string,
    userId: string,
    delta: number,
    eventId: string,
  ): Promise<{ applied: boolean; score: number | null }> {
    const lockKey = idempotencyKey("score-event", eventId);
    const zsetKey = leaderboardKey(leaderboardId);
    const raw = (await this.redis
      .getClient()
      .eval(APPLY_DELTA_ONCE_SCRIPT, 2, lockKey, zsetKey, String(IDEMPOTENCY_TTL_SECONDS), userId, String(delta))) as [
      number,
      string | null,
    ];
    const [appliedFlag, scoreRaw] = raw;
    const applied = appliedFlag === 1;
    const score = scoreRaw !== null ? Number(scoreRaw) : null;

    if (applied) {
      this.metrics.scoreEventsApplied.inc({ leaderboardId });
      this.adminEvents.emit({
        type: "applied",
        message: `${userId} 점수 반영 (${delta >= 0 ? "+" : ""}${delta} → ${score}점)`,
        at: new Date().toISOString(),
      });
    } else {
      this.metrics.scoreEventsDeduped.inc({ leaderboardId });
    }
    return { applied, score };
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
