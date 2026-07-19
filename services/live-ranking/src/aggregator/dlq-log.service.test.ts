import { describe, it, expect } from "vitest";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import { FakeRedisClient } from "../test-utils/fake-redis-client";
import { DLQ_LOG_LIMIT } from "../shared/constants";
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

  it("clear는 확인용 목록만 비우고, 누적 총량(count)은 그대로 남는다", async () => {
    const { service } = createService();
    await service.record(entry("u1"));
    await service.clear();

    const overview = await service.getOverview();
    expect(overview.recent).toEqual([]);
    expect(overview.count).toBe(1); // 실제로 있었던 실패 건수 — clear로 지워지지 않아야 함
  });

  it("ltrim으로 목록은 최근 DLQ_LOG_LIMIT건만 남지만, count는 계속 누적된다", async () => {
    const { service } = createService();
    const total = DLQ_LOG_LIMIT + 5;
    for (let i = 0; i < total; i++) {
      await service.record(entry("u" + i));
    }

    const overview = await service.getOverview();
    expect(overview.count).toBe(total);
    expect(overview.recent).toHaveLength(DLQ_LOG_LIMIT);
    expect(overview.recent[0].userId).toBe("u" + (total - 1)); // 가장 최근 게 맨 앞
  });
});
