import { Inject, Injectable } from "@nestjs/common";
import { InjectRedis } from "@paikpaik/node-forge/redis/nestjs";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import { ForgeBizError } from "@paikpaik/node-forge/core";
import { AdminEventBus } from "@paikpaik/node-forge/events";
import { ADMIN_EVENT_BUS } from "@paikpaik/node-forge/events/nestjs";
import { admissionLogKey, admittedKey, queueKey, ADMISSION_ROOM_ID } from "./waiting-room.constants";
import { TokenService } from "./token.service";
import type {
  QueueOverviewDto,
  RegisterResultDto,
  VerifyTokenResultDto,
  WaitingStatusDto,
} from "./dto/waiting-status.dto";
import { WaitingRoomMetrics } from "./waiting-room.metrics";
import type { AdminLogEvent } from "./admin-log-event";

@Injectable()
export class WaitingRoomService {
  constructor(
    @InjectRedis() private readonly redis: ForgeRedisClient,
    private readonly tokenService: TokenService,
    private readonly metrics: WaitingRoomMetrics,
    @Inject(ADMIN_EVENT_BUS) private readonly adminEvents: AdminEventBus<AdminLogEvent>,
  ) {}

  async register(roomId: string, userId: string): Promise<RegisterResultDto> {
    // admission 스케줄러는 ADMISSION_ROOM_ID 하나만 순회한다 (멀티룸 스코프 아웃). 다른
    // roomId로 등록을 허용하면 영원히 admission되지 않는 채로 조용히 굶는 유저가 생기므로
    // 여기서 명시적으로 막는다.
    if (roomId !== ADMISSION_ROOM_ID) {
      throw new ForgeBizError("E9400", `지원하지 않는 room입니다: ${roomId}`);
    }

    const key = queueKey(roomId);

    // zscore로 조회한 뒤 zadd로 쓰는 방식은 두 단계 사이에 원자성이 없어서, 같은 userId로
    // 동시에 요청이 오면 중복 등록 방지가 깨진다(둘 다 "없음"을 보고 통과해버림). mode: "NX"는
    // Redis가 "member가 없을 때만 추가"를 원자적으로 보장하므로 이 문제가 생기지 않는다
    // (node-forge 1.0.3, proposals/node-forge/20260717/20260717-zadd-nx-option.md).
    const added = await this.redis.zadd(key, [{ score: Date.now(), member: userId }], { mode: "NX" });
    if (added === 0) {
      throw new ForgeBizError("E9409", "이미 대기 중인 사용자입니다");
    }

    const [rank, queueLength] = await Promise.all([
      this.redis.zrank(key, userId),
      this.redis.zcard(key),
    ]);
    this.metrics.queueLength.set({ roomId }, queueLength);

    const position = (rank ?? 0) + 1;
    this.adminEvents.emit({
      type: "joined",
      message: `${userId} 등록 완료 (순번 ${position}, 대기 ${queueLength}명)`,
      at: new Date().toISOString(),
    });
    return { position, queueLength };
  }

  /**
   * 발급된 입장 토큰을 검증한다. 서명이 유효해도 Redis에 저장된 admitted 값과 다르면
   * (TTL 만료, reset, 재발급 등) 무효로 처리한다 — HMAC 서명 자체는 "위조 안 됐다"만
   * 보장하고 "아직 유효 기간이다"는 보장 안 하기 때문에, 실제 유효성의 기준은 항상 Redis다.
   */
  async verifyToken(roomId: string, token: string): Promise<VerifyTokenResultDto> {
    const decoded = this.tokenService.verify(token);
    if (!decoded || decoded.roomId !== roomId) {
      return { valid: false };
    }

    const stored = await this.redis.get<string>(admittedKey(decoded.roomId, decoded.userId));
    if (stored !== token) {
      return { valid: false };
    }

    return { valid: true, userId: decoded.userId };
  }

  async getStatus(roomId: string, userId: string): Promise<WaitingStatusDto> {
    const token = await this.redis.get<string>(admittedKey(roomId, userId));
    if (token !== null) {
      return { status: "admitted", token };
    }

    const key = queueKey(roomId);
    const rank = await this.redis.zrank(key, userId);
    if (rank !== null) {
      const queueLength = await this.redis.zcard(key);
      return { status: "waiting", position: rank + 1, queueLength };
    }

    // admittedKey는 TTL이 지나면 사라지므로, 그것만으로는 "한 번도 등록 안 한 사람"과
    // "입장 기회를 놓친 사람"을 구분할 수 없다. 더 오래 남는 admission-log로 구분한다.
    const admittedBefore = await this.redis.get<string>(admissionLogKey(roomId, userId));
    if (admittedBefore !== null) {
      return { status: "expired" };
    }

    return { status: "not_found" };
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

  /**
   * 지정한 userId들만 대기열에서 뺀다. panel.html의 부하 시뮬레이션 "중지"가 이걸 쓴다 —
   * 시뮬레이션이 등록한 사람들만 골라서 취소하고, "내 티켓" 등 다른 등록엔 손대지 않는다
   * (전체를 지우는 reset()과 다른 점). 이미 admission된(대기열에 없는) userId를 넘겨도
   * zrem이 그냥 무시하므로 안전하다.
   */
  async removeUsers(roomId: string, userIds: string[]): Promise<{ removed: number }> {
    if (userIds.length === 0) return { removed: 0 };

    const key = queueKey(roomId);
    const removed = await this.redis.zrem(key, ...userIds);
    const queueLength = await this.redis.zcard(key);
    this.metrics.queueLength.set({ roomId }, queueLength);

    return { removed };
  }

  /**
   * 대기열, admitted 키, admission-log 키를 전부 지운다. 반복 테스트할 때 매번 컨테이너를
   * 재시작하지 않고 깨끗한 상태로 되돌리기 위한 용도 (테스트/데모 전용, 운영 API 아님).
   */
  async reset(roomId: string): Promise<void> {
    const [admittedKeys, admissionLogKeys] = await Promise.all([
      this.redis.scanKeys(admittedKey(roomId, "*")),
      this.redis.scanKeys(admissionLogKey(roomId, "*")),
    ]);
    const keysToDelete = [queueKey(roomId), ...admittedKeys, ...admissionLogKeys];
    await this.redis.del(...keysToDelete);
    this.metrics.queueLength.set({ roomId }, 0);
  }
}
