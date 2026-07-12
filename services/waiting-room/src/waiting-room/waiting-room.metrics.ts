import { Inject, Injectable } from "@nestjs/common";
import { METRICS_INSTANCE } from "@paikpaik/node-forge/metrics/nestjs";
import type { ForgeMetrics } from "@paikpaik/node-forge/metrics";
import type { Counter, Gauge, Histogram } from "prom-client";

@Injectable()
export class WaitingRoomMetrics {
  readonly queueLength: Gauge<"roomId">;
  readonly waitTimeMs: Histogram<"roomId">;
  readonly admissionsTotal: Counter<"roomId">;

  constructor(@Inject(METRICS_INSTANCE) metrics: ForgeMetrics) {
    this.queueLength = metrics.gauge({
      name: "waiting_room_queue_length",
      help: "현재 대기열에 남아있는 인원 수",
      labelNames: ["roomId"],
    });
    this.waitTimeMs = metrics.histogram({
      name: "waiting_room_wait_time_ms",
      help: "등록부터 admission까지 걸린 시간(ms)",
      labelNames: ["roomId"],
      buckets: [100, 500, 1000, 5000, 10000, 30000, 60000, 300000],
    });
    this.admissionsTotal = metrics.counter({
      name: "waiting_room_admissions_total",
      help: "admission 처리된 누적 인원",
      labelNames: ["roomId"],
    });
  }
}
