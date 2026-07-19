import { describe, it, expect } from "vitest";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import { FakeRedisClient } from "../test-utils/fake-redis-client";
import { DlqLogService } from "./dlq-log.service";

function createService() {
  const redis = new FakeRedisClient();
  const service = new DlqLogService(redis as unknown as ForgeRedisClient);
  return { service };
}

const entry = (userId: string) => ({
  userId,
  leaderboardId: "default",
  delta: 5,
  error: "boom",
  failedAt: new Date().toISOString(),
});

describe("DlqLogService", () => {
  it("아무것도 기록 안 하면 count 0, recent 빈 배열", async () => {
    const { service } = createService();
    expect(await service.getOverview()).toEqual({ count: 0, recent: [] });
  });

  it("기록한 만큼 count가 올라가고, 최근 순(뒤에 기록한 게 앞)으로 조회된다", async () => {
    const { service } = createService();
    await service.record(entry("u1"));
    await service.record(entry("u2"));

    const overview = await service.getOverview();
    expect(overview.count).toBe(2);
    expect(overview.recent.map((e) => e.userId)).toEqual(["u2", "u1"]);
  });

  it("clear 이후에는 다시 비어있다", async () => {
    const { service } = createService();
    await service.record(entry("u1"));
    await service.clear();
    expect(await service.getOverview()).toEqual({ count: 0, recent: [] });
  });
});
