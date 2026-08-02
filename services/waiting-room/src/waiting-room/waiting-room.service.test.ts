import { describe, it, expect } from "vitest";
import { ForgeMetrics } from "@paikpaik/node-forge/metrics";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import { AdminEventBus } from "@paikpaik/node-forge/events";
import { WaitingRoomService } from "./waiting-room.service";
import { WaitingRoomMetrics } from "./waiting-room.metrics";
import { TokenService } from "./token.service";
import { ADMISSION_ROOM_ID, admissionLogKey, admittedKey } from "./waiting-room.constants";
import { FakeRedisClient } from "./test-utils/fake-redis-client";
import type { AdminLogEvent } from "./admin-log-event";

function createService() {
  const redis = new FakeRedisClient();
  const tokenService = new TokenService();
  const metrics = new WaitingRoomMetrics(new ForgeMetrics({ defaultMetrics: false }));
  const service = new WaitingRoomService(
    redis as unknown as ForgeRedisClient,
    tokenService,
    metrics,
    new AdminEventBus<AdminLogEvent>(),
  );
  return { service, redis, tokenService };
}

describe("WaitingRoomService.register", () => {
  it("정상 등록하면 순번 1을 받는다", async () => {
    const { service } = createService();
    const result = await service.register(ADMISSION_ROOM_ID, "u1");
    expect(result).toEqual({ position: 1, queueLength: 1 });
  });

  it("같은 userId로 두 번 등록하면 두 번째는 E9409로 거부된다 (zadd NX)", async () => {
    const { service } = createService();
    await service.register(ADMISSION_ROOM_ID, "u1");
    await expect(service.register(ADMISSION_ROOM_ID, "u1")).rejects.toMatchObject({ code: "E9409" });
  });

  it("지원하지 않는 roomId면 E9400으로 거부된다", async () => {
    const { service } = createService();
    await expect(service.register("other-room", "u1")).rejects.toMatchObject({ code: "E9400" });
  });
});

describe("WaitingRoomService.getStatus", () => {
  it("등록하지 않은 유저는 not_found", async () => {
    const { service } = createService();
    expect(await service.getStatus(ADMISSION_ROOM_ID, "nope")).toEqual({ status: "not_found" });
  });

  it("등록한 유저는 waiting과 순번을 반환한다", async () => {
    const { service } = createService();
    await service.register(ADMISSION_ROOM_ID, "u1");
    expect(await service.getStatus(ADMISSION_ROOM_ID, "u1")).toEqual({
      status: "waiting",
      position: 1,
      queueLength: 1,
    });
  });

  it("admitted 토큰이 있으면 admitted를 반환한다", async () => {
    const { service, redis } = createService();
    await redis.set(admittedKey(ADMISSION_ROOM_ID, "u1"), "some-token", 300);
    expect(await service.getStatus(ADMISSION_ROOM_ID, "u1")).toEqual({
      status: "admitted",
      token: "some-token",
    });
  });

  it("admitted 토큰은 만료됐지만 admission-log가 남아있으면 expired를 반환한다", async () => {
    const { service, redis } = createService();
    // admittedKey는 설정하지 않는다 — TTL이 지나 사라진 상황을 흉내낸다.
    await redis.set(admissionLogKey(ADMISSION_ROOM_ID, "u1"), String(Date.now()), 3600);
    expect(await service.getStatus(ADMISSION_ROOM_ID, "u1")).toEqual({ status: "expired" });
  });
});

describe("WaitingRoomService.verifyToken", () => {
  it("실제 admitted된 토큰은 valid: true", async () => {
    const { service, redis, tokenService } = createService();
    const token = tokenService.issue(ADMISSION_ROOM_ID, "u1");
    await redis.set(admittedKey(ADMISSION_ROOM_ID, "u1"), token, 300);
    expect(await service.verifyToken(ADMISSION_ROOM_ID, token)).toEqual({ valid: true, userId: "u1" });
  });

  it("서명은 유효해도 Redis에 저장된 값과 다르면 invalid (TTL 만료 흉내)", async () => {
    const { service, tokenService } = createService();
    const token = tokenService.issue(ADMISSION_ROOM_ID, "u1");
    expect(await service.verifyToken(ADMISSION_ROOM_ID, token)).toEqual({ valid: false });
  });

  it("변조된 토큰은 invalid", async () => {
    const { service } = createService();
    expect(await service.verifyToken(ADMISSION_ROOM_ID, "garbage")).toEqual({ valid: false });
  });
});

describe("WaitingRoomService.removeUsers", () => {
  it("지정한 userId만 대기열에서 지우고, 나머지는 그대로 둔다", async () => {
    const { service } = createService();
    await service.register(ADMISSION_ROOM_ID, "burst-1");
    await service.register(ADMISSION_ROOM_ID, "burst-2");
    await service.register(ADMISSION_ROOM_ID, "my-ticket");

    const result = await service.removeUsers(ADMISSION_ROOM_ID, ["burst-1", "burst-2"]);

    expect(result).toEqual({ removed: 2 });
    expect(await service.getStatus(ADMISSION_ROOM_ID, "burst-1")).toEqual({ status: "not_found" });
    expect(await service.getStatus(ADMISSION_ROOM_ID, "my-ticket")).toEqual({
      status: "waiting",
      position: 1,
      queueLength: 1,
    });
  });

  it("이미 대기열에 없는(예: admission된) userId를 넘겨도 안전하게 무시한다", async () => {
    const { service } = createService();
    const result = await service.removeUsers(ADMISSION_ROOM_ID, ["already-gone"]);
    expect(result).toEqual({ removed: 0 });
  });
});

describe("WaitingRoomService.reset", () => {
  it("큐, admitted, admission-log를 전부 지운다", async () => {
    const { service, redis } = createService();
    await service.register(ADMISSION_ROOM_ID, "u1");
    await redis.set(admittedKey(ADMISSION_ROOM_ID, "u2"), "tok", 300);
    await redis.set(admissionLogKey(ADMISSION_ROOM_ID, "u3"), "1", 3600);

    await service.reset(ADMISSION_ROOM_ID);

    expect(await service.getStatus(ADMISSION_ROOM_ID, "u1")).toEqual({ status: "not_found" });
    expect(await service.getStatus(ADMISSION_ROOM_ID, "u2")).toEqual({ status: "not_found" });
    expect(await service.getStatus(ADMISSION_ROOM_ID, "u3")).toEqual({ status: "not_found" });
  });
});
