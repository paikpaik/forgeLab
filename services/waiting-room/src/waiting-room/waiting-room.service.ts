import { Injectable } from "@nestjs/common";
import { InjectRedis } from "@paikpaik/node-forge/redis/nestjs";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import { ForgeBizError } from "@paikpaik/node-forge/core";
import { admittedKey, queueKey } from "./waiting-room.constants";
import type { QueueOverviewDto, RegisterResultDto, WaitingStatusDto } from "./dto/waiting-status.dto";
import { WaitingRoomMetrics } from "./waiting-room.metrics";

@Injectable()
export class WaitingRoomService {
  constructor(
    @InjectRedis() private readonly redis: ForgeRedisClient,
    private readonly metrics: WaitingRoomMetrics,
  ) {}

  async register(roomId: string, userId: string): Promise<RegisterResultDto> {
    const key = queueKey(roomId);

    const existing = await this.redis.zscore(key, userId);
    if (existing !== null) {
      throw new ForgeBizError("E9409", "이미 대기 중인 사용자입니다");
    }

    await this.redis.zadd(key, [{ score: Date.now(), member: userId }]);
    const [rank, queueLength] = await Promise.all([
      this.redis.zrank(key, userId),
      this.redis.zcard(key),
    ]);
    this.metrics.queueLength.set({ roomId }, queueLength);

    return { position: (rank ?? 0) + 1, queueLength };
  }

  async getStatus(roomId: string, userId: string): Promise<WaitingStatusDto> {
    const token = await this.redis.get<string>(admittedKey(roomId, userId));
    if (token !== null) {
      return { status: "admitted", token };
    }

    const key = queueKey(roomId);
    const rank = await this.redis.zrank(key, userId);
    if (rank === null) {
      return { status: "not_found" };
    }

    const queueLength = await this.redis.zcard(key);
    return { status: "waiting", position: rank + 1, queueLength };
  }

  /**
   * 대기열 앞쪽 일부(기본 20명)와 전체 길이를 보여준다. 대시보드의 "상태 보기" 패널이
   * 주기적으로 폴링해서 큐가 쌓이고 빠지는 걸 실시간으로 확인하는 용도.
   */
  async getOverview(roomId: string, limit = 20): Promise<QueueOverviewDto> {
    const key = queueKey(roomId);
    const [entries, queueLength] = await Promise.all([
      this.redis.zrangeWithScores(key, 0, limit - 1),
      this.redis.zcard(key),
    ]);

    return {
      queueLength,
      waiting: entries.map((entry, index) => ({ userId: entry.member, position: index + 1 })),
    };
  }
}
