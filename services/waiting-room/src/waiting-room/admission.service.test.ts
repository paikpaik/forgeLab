import { describe, it, expect, vi } from "vitest";
import { ForgeMetrics } from "@paikpaik/node-forge/metrics";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import { AdmissionService } from "./admission.service";
import { WaitingRoomMetrics } from "./waiting-room.metrics";
import { TokenService } from "./token.service";
import { ADMISSION_ROOM_ID, admittedKey, queueKey } from "./waiting-room.constants";
import { FakeRedisClient } from "./test-utils/fake-redis-client";

function createAdmissionService() {
  const redis = new FakeRedisClient();
  const tokenService = new TokenService();
  const metrics = new WaitingRoomMetrics(new ForgeMetrics({ defaultMetrics: false }));
  const service = new AdmissionService(redis as unknown as ForgeRedisClient, tokenService, metrics);
  return { service, redis };
}

describe("AdmissionService.runAdmission", () => {
  it("대기열 상위 N명을 admitted 처리하고 대기열에서 제거한다", async () => {
    const { service, redis } = createAdmissionService();
    const key = queueKey(ADMISSION_ROOM_ID);
    for (let i = 0; i < 15; i++) {
      await redis.zadd(key, [{ score: i, member: `u${i}` }]);
    }

    await service.runAdmission();

    expect(await redis.zcard(key)).toBe(5); // 배치 크기 10 처리, 15 - 10 = 5명 남음
    expect(await redis.get(admittedKey(ADMISSION_ROOM_ID, "u0"))).not.toBeNull();
    expect(await redis.get(admittedKey(ADMISSION_ROOM_ID, "u9"))).not.toBeNull();
    expect(await redis.get(admittedKey(ADMISSION_ROOM_ID, "u10"))).toBeNull(); // 아직 대기 중
  });

  it("빈 대기열이면 아무 일도 하지 않는다", async () => {
    const { service, redis } = createAdmissionService();
    await expect(service.runAdmission()).resolves.toBeUndefined();
    expect(await redis.zcard(queueKey(ADMISSION_ROOM_ID))).toBe(0);
  });

  it("토큰 저장이 실패한 멤버는 대기열에서 지워지지 않는다 (유실 대신 다음 주기 재시도)", async () => {
    const { service, redis } = createAdmissionService();
    const key = queueKey(ADMISSION_ROOM_ID);
    await redis.zadd(key, [{ score: 1, member: "ok-user" }]);
    await redis.zadd(key, [{ score: 2, member: "fail-user" }]);

    const originalSet = redis.set.bind(redis);
    vi.spyOn(redis, "set").mockImplementation(async (k: string, v: unknown, ttl?: number) => {
      if (k.includes("fail-user")) throw new Error("redis 장애 시뮬레이션");
      return originalSet(k, v, ttl);
    });

    await service.runAdmission();

    // 실패한 유저는 zpopmin처럼 먼저 지워지지 않고 대기열에 그대로 남아있어야 한다.
    expect(await redis.zrank(key, "fail-user")).not.toBeNull();
    // 성공한 유저는 처리되어 대기열에서 빠지고 토큰을 받는다.
    expect(await redis.zrank(key, "ok-user")).toBeNull();
    expect(await redis.get(admittedKey(ADMISSION_ROOM_ID, "ok-user"))).not.toBeNull();
  });
});
