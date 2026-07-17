import { Inject, Injectable } from "@nestjs/common";
import { METRICS_INSTANCE } from "@paikpaik/node-forge/metrics/nestjs";
import type { ForgeMetrics } from "@paikpaik/node-forge/metrics";
import type { Counter } from "prom-client";

@Injectable()
export class RankingMetrics {
  readonly scoreEventsApplied: Counter<"leaderboardId">;

  constructor(@Inject(METRICS_INSTANCE) metrics: ForgeMetrics) {
    this.scoreEventsApplied = metrics.counter({
      name: "live_ranking_score_events_applied_total",
      help: "Redis ZSET에 실제로 반영된 점수 이벤트 수",
      labelNames: ["leaderboardId"],
    });
    // 멱등성으로 스킵된 건수는 더 이상 여기서 직접 안 잰다 — kafka-forge 1.0.2의
    // kafka_forge_deduped_total이 StandardConsumer 안에서 표준으로 잡아준다
    // (proposals/kafka-forge/20260717-consumer-dedup-metric.md 반영).
  }
}
