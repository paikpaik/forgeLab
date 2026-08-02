import { Inject, Injectable } from "@nestjs/common";
import { InjectRedis } from "@paikpaik/node-forge/redis/nestjs";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import { AdminEventBus } from "@paikpaik/node-forge/events";
import { ADMIN_EVENT_BUS } from "@paikpaik/node-forge/events/nestjs";
import { DLQ_LOG_KEY, DLQ_LOG_LIMIT, DLQ_TOTAL_KEY } from "../shared/constants";
import type { AdminLogEvent } from "./admin-log-event";

export interface DlqLogEntry {
  userId: string;
  leaderboardId: string;
  delta: number;
  error: string;
  failedAt: string;
}

export interface DlqOverview {
  count: number;
  recent: DlqLogEntry[];
}

// kafka-forge의 StandardConsumer는 재시도(3회) 소진 시 메시지를 <topic>.dlq로 옮겨줄 뿐,
// 그걸 누가 보고 있는지는 전혀 신경 쓰지 않는다. 아무도 구독 안 하면 실패한 이벤트가 조용히
// 사라지는 것처럼 보인다 — 이 서비스가 그 DLQ 토픽의 내용을 사람이 볼 수 있게 Redis에 얕은
// 로그로 옮겨 담는다(진짜 큐/재처리 대상이 아니라 "확인용" 사본).
@Injectable()
export class DlqLogService {
  constructor(
    @InjectRedis() private readonly redis: ForgeRedisClient,
    @Inject(ADMIN_EVENT_BUS) private readonly adminEvents: AdminEventBus<AdminLogEvent>,
  ) {}

  async record(entry: DlqLogEntry): Promise<void> {
    // 누적 총량은 별도 카운터로 잰다 — 아래 ltrim으로 리스트 자체는 최근 N건만 남기기
    // 때문에 llen으로는 "총 몇 건 실패했는지"를 알 수 없다(node-forge 1.0.4의 ltrim으로
    // 무한 growth 문제를 해결하면서 생긴 트레이드오프).
    await this.redis.incr(DLQ_TOTAL_KEY);
    await this.redis.lpush(DLQ_LOG_KEY, entry);
    await this.redis.ltrim(DLQ_LOG_KEY, 0, DLQ_LOG_LIMIT - 1);
    this.adminEvents.emit({
      type: "dlq",
      message: `DLQ 이동 — ${entry.userId} (${entry.delta}점) — ${entry.error}`,
      at: entry.failedAt,
    });
  }

  async getOverview(): Promise<DlqOverview> {
    const [totalRaw, recent] = await Promise.all([
      this.redis.get(DLQ_TOTAL_KEY),
      this.redis.lrange<DlqLogEntry>(DLQ_LOG_KEY, 0, DLQ_LOG_LIMIT - 1),
    ]);
    return { count: totalRaw ? Number(totalRaw) : 0, recent };
  }

  // "지우기"는 확인용 목록만 비운다 — 총 실패 건수(DLQ_TOTAL_KEY)는 실제로 있었던 일이니
  // 지우지 않는다(kafka-forge의 kafka_forge_consume_errors_total과 의미를 맞춤).
  async clear(): Promise<void> {
    await this.redis.del(DLQ_LOG_KEY);
  }
}
