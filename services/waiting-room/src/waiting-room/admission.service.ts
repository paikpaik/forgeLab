import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { InjectRedis } from "@paikpaik/node-forge/redis/nestjs";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import {
  ADMISSION_BATCH_SIZE,
  ADMISSION_INTERVAL_MS,
  ADMISSION_ROOM_ID,
  ADMITTED_TOKEN_TTL_SECONDS,
  admittedKey,
  queueKey,
} from "./waiting-room.constants";
import { TokenService } from "./token.service";
import { WaitingRoomMetrics } from "./waiting-room.metrics";

/**
 * zpopmin은 Redis 네이티브 명령이라 그 자체로 원자적이다 — "조회 후 제거" 사이에 다른
 * 프로세스가 끼어들 여지가 없으므로 별도 Lua 스크립트나 락이 필요 없다. 단, 여러 앱 인스턴스가
 * 동시에 스케줄을 돌리면 각자 다른 배치를 소비하므로 실질 admission 속도가 인스턴스 수만큼
 * 늘어난다 — 다중 인스턴스 조율은 스코프 아웃(단일 인스턴스 전제).
 */
@Injectable()
export class AdmissionService {
  private readonly logger = new Logger(AdmissionService.name);

  constructor(
    @InjectRedis() private readonly redis: ForgeRedisClient,
    private readonly tokenService: TokenService,
    private readonly metrics: WaitingRoomMetrics,
  ) {}

  @Interval(ADMISSION_INTERVAL_MS)
  async runAdmission(): Promise<void> {
    const roomId = ADMISSION_ROOM_ID;
    const key = queueKey(roomId);

    const admitted = await this.redis.zpopmin(key, ADMISSION_BATCH_SIZE);
    if (admitted.length === 0) return;

    const now = Date.now();
    await Promise.all(
      admitted.map(async ({ member: userId, score: registeredAt }) => {
        const token = this.tokenService.issue(roomId, userId);
        await this.redis.set(admittedKey(roomId, userId), token, ADMITTED_TOKEN_TTL_SECONDS);
        this.metrics.waitTimeMs.observe({ roomId }, now - registeredAt);
      }),
    );

    this.metrics.admissionsTotal.inc({ roomId }, admitted.length);
    const queueLength = await this.redis.zcard(key);
    this.metrics.queueLength.set({ roomId }, queueLength);

    this.logger.log(`admitted ${admitted.length} user(s) in room=${roomId}`);
  }
}
