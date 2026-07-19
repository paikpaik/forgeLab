import { Injectable } from "@nestjs/common";
import { InjectRedis } from "@paikpaik/node-forge/redis/nestjs";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import { DLQ_LOG_KEY, DLQ_LOG_LIMIT } from "../shared/constants";

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
  constructor(@InjectRedis() private readonly redis: ForgeRedisClient) {}

  async record(entry: DlqLogEntry): Promise<void> {
    await this.redis.lpush(DLQ_LOG_KEY, entry);
  }

  async getOverview(): Promise<DlqOverview> {
    const [count, recent] = await Promise.all([
      this.redis.llen(DLQ_LOG_KEY),
      this.redis.lrange<DlqLogEntry>(DLQ_LOG_KEY, 0, DLQ_LOG_LIMIT - 1),
    ]);
    return { count, recent };
  }

  async clear(): Promise<void> {
    await this.redis.del(DLQ_LOG_KEY);
  }
}
