import { Inject, Injectable } from "@nestjs/common";
import { METRICS_INSTANCE } from "@paikpaik/node-forge/metrics/nestjs";
import type { ForgeMetrics } from "@paikpaik/node-forge/metrics";
import type { Counter } from "prom-client";

@Injectable()
export class RankingMetrics {
  readonly scoreEventsApplied: Counter<"leaderboardId">;
  readonly scoreEventsDeduped: Counter<"leaderboardId">;

  constructor(@Inject(METRICS_INSTANCE) metrics: ForgeMetrics) {
    this.scoreEventsApplied = metrics.counter({
      name: "live_ranking_score_events_applied_total",
      help: "Redis ZSET에 실제로 반영된 점수 이벤트 수",
      labelNames: ["leaderboardId"],
    });
    // 2026-08-01: claim(선점)과 이펙트(zincrby) 사이의 크래시 윈도우(선점만 되고 이펙트가
    // 반영 안 된 채 영구 유실되는 버그, 실제 docker kill로 재현 확인)를 막기 위해 이 두
    // 단계를 하나의 Lua 스크립트로 원자화했다(RankingService.applyDeltaOnce) — 그 결과
    // kafka-forge StandardConsumer의 idempotencyStore 경유 claim을 이 이벤트에는 더 이상
    // 쓰지 않으므로, kafka_forge_deduped_total이 이 토픽 값을 더 이상 안 잡아준다. 그래서
    // 다시 로컬로 잰다(kafka-forge 1.0.2 이전과 같은 상황으로 되돌아간 것 — 원자성과
    // 표준 지표를 동시에 가질 수는 없어서 원자성을 택함).
    this.scoreEventsDeduped = metrics.counter({
      name: "live_ranking_score_events_deduped_total",
      help: "claim+이펙트 원자화 처리에서 중복으로 판정되어 스킵된 점수 이벤트 수",
      labelNames: ["leaderboardId"],
    });
  }
}
