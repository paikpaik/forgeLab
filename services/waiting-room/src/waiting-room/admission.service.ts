import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { InjectRedis } from "@paikpaik/node-forge/redis/nestjs";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import { AdminEventBus } from "@paikpaik/node-forge/events";
import { ADMIN_EVENT_BUS } from "@paikpaik/node-forge/events/nestjs";
import {
  ADMISSION_BATCH_SIZE,
  ADMISSION_INTERVAL_MS,
  ADMISSION_LOG_TTL_SECONDS,
  ADMISSION_ROOM_ID,
  ADMITTED_TOKEN_TTL_SECONDS,
  admissionLogKey,
  admittedKey,
  queueKey,
} from "./waiting-room.constants";
import { TokenService } from "./token.service";
import { WaitingRoomMetrics } from "./waiting-room.metrics";
import type { AdminLogEvent } from "./admin-log-event";

/**
 * 대기열에서 "제거"(zrem, 커밋)는 토큰 저장까지 실제로 성공한 멤버에 대해서만, 맨 마지막에
 * 한다. zpopmin으로 먼저 제거해버리면, 그 뒤 토큰 저장 도중 프로세스가 어떤 이유로든
 * 죽었을 때(에러뿐 아니라 SIGKILL 같은 강제 종료까지 포함) 이미 대기열에서도 지워지고
 * admitted도 안 된 유저가 생긴다. zrangeWithScores는 조회만 하고 부작용이 없으므로, 이
 * 순서(조회 → 처리 시도 → 성공분만 커밋)면 프로세스가 어느 시점에 죽어도 최악의 경우
 * "이번 주기에 처리 안 되고 다음 주기에 다시 시도"일 뿐, 유저가 사라지지는 않는다.
 * 여러 앱 인스턴스가 동시에 스케줄을 돌리는 다중 인스턴스 조율은 스코프 아웃(단일 인스턴스 전제).
 */
@Injectable()
export class AdmissionService {
  private readonly logger = new Logger(AdmissionService.name);

  constructor(
    @InjectRedis() private readonly redis: ForgeRedisClient,
    private readonly tokenService: TokenService,
    private readonly metrics: WaitingRoomMetrics,
    @Inject(ADMIN_EVENT_BUS) private readonly adminEvents: AdminEventBus<AdminLogEvent>,
  ) {}

  @Interval(ADMISSION_INTERVAL_MS)
  async runAdmission(): Promise<void> {
    const roomId = ADMISSION_ROOM_ID;
    const key = queueKey(roomId);

    const candidates = await this.redis.zrangeWithScores(key, 0, ADMISSION_BATCH_SIZE - 1);
    if (candidates.length === 0) return;

    const now = Date.now();
    const results = await Promise.allSettled(
      candidates.map(async ({ member: userId, score: registeredAt }) => {
        const token = this.tokenService.issue(roomId, userId);
        await this.redis.set(admittedKey(roomId, userId), token, ADMITTED_TOKEN_TTL_SECONDS);
        await this.redis.set(admissionLogKey(roomId, userId), String(now), ADMISSION_LOG_TTL_SECONDS);
        this.metrics.waitTimeMs.observe({ roomId }, now - registeredAt);
      }),
    );

    const succeeded = candidates.filter((_, i) => results[i]?.status === "fulfilled");
    if (succeeded.length > 0) {
      // 실제로 admitted 처리된 멤버만 대기열에서 지운다 — 이 zrem이 이번 주기의 "커밋" 지점이다.
      await this.redis.zrem(key, ...succeeded.map((c) => c.member));
      this.metrics.admissionsTotal.inc({ roomId }, succeeded.length);
    }

    const failedCount = candidates.length - succeeded.length;
    if (failedCount > 0) {
      this.logger.error(
        `admission 처리 실패 ${failedCount}건 (대기열에 남아있어 다음 주기에 재시도됨)`,
      );
    }

    const queueLength = await this.redis.zcard(key);
    this.metrics.queueLength.set({ roomId }, queueLength);

    if (succeeded.length > 0) {
      this.adminEvents.emit({
        type: "admitted",
        message: `입장 허용 ${succeeded.length}/${candidates.length}명 (대기열 ${queueLength}명 남음)`,
        at: new Date().toISOString(),
      });
    }

    this.logger.log(`admitted ${succeeded.length}/${candidates.length} user(s) in room=${roomId}`);
  }
}
