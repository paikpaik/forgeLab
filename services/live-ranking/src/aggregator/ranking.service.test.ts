import { describe, it, expect } from "vitest";
import { ForgeMetrics } from "@paikpaik/node-forge/metrics";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import { AdminEventBus } from "@paikpaik/node-forge/events";
import { FakeRedisClient } from "../test-utils/fake-redis-client";
import { RankingService } from "./ranking.service";
import { RankingMetrics } from "./ranking.metrics";
import type { AdminLogEvent } from "./admin-log-event";

function createService() {
  const redis = new FakeRedisClient();
  const metrics = new RankingMetrics(new ForgeMetrics({ defaultMetrics: false }));
  const service = new RankingService(
    redis as unknown as ForgeRedisClient,
    metrics,
    new AdminEventBus<AdminLogEvent>(),
  );
  return { service, redis };
}

describe("RankingService.applyDelta", () => {
  it("첫 반영은 delta 그대로가 누적 점수가 된다", async () => {
    const { service } = createService();
    const score = await service.applyDelta("default", "u1", 10);
    expect(score).toBe(10);
  });

  it("같은 유저에게 여러 번 반영하면 누적된다", async () => {
    const { service } = createService();
    await service.applyDelta("default", "u1", 10);
    const score = await service.applyDelta("default", "u1", 5);
    expect(score).toBe(15);
  });

  it("음수 delta로 점수를 깎을 수 있다", async () => {
    const { service } = createService();
    await service.applyDelta("default", "u1", 10);
    const score = await service.applyDelta("default", "u1", -3);
    expect(score).toBe(7);
  });
});

describe("RankingService.applyDeltaOnce — claim+이펙트 원자화", () => {
  it("처음 보는 eventId는 반영되고 applied: true", async () => {
    const { service } = createService();
    const result = await service.applyDeltaOnce("default", "u1", 10, "event-1");
    expect(result).toEqual({ applied: true, score: 10 });
  });

  it("같은 eventId로 다시 호출해도 반영되지 않는다(재배달 시뮬레이션) — applied: false, 점수 불변", async () => {
    const { service } = createService();
    await service.applyDeltaOnce("default", "u1", 10, "event-1");
    const result = await service.applyDeltaOnce("default", "u1", 10, "event-1");
    expect(result).toEqual({ applied: false, score: 10 });
    expect(await service.getUserRank("default", "u1")).toEqual({ rank: 1, score: 10 });
  });

  it("다른 eventId면 같은 유저라도 각각 반영되어 누적된다", async () => {
    const { service } = createService();
    await service.applyDeltaOnce("default", "u1", 10, "event-1");
    const result = await service.applyDeltaOnce("default", "u1", 5, "event-2");
    expect(result).toEqual({ applied: true, score: 15 });
  });
});

describe("RankingService.getTop", () => {
  it("점수 내림차순으로 순위를 매겨 반환한다", async () => {
    const { service } = createService();
    await service.applyDelta("default", "u1", 10);
    await service.applyDelta("default", "u2", 30);
    await service.applyDelta("default", "u3", 20);

    const top = await service.getTop("default", 10);
    expect(top).toEqual([
      { userId: "u2", score: 30, rank: 1 },
      { userId: "u3", score: 20, rank: 2 },
      { userId: "u1", score: 10, rank: 3 },
    ]);
  });

  it("limit보다 참가자가 많으면 상위 limit명만 반환한다", async () => {
    const { service } = createService();
    await service.applyDelta("default", "u1", 10);
    await service.applyDelta("default", "u2", 20);

    const top = await service.getTop("default", 1);
    expect(top).toEqual([{ userId: "u2", score: 20, rank: 1 }]);
  });
});

describe("RankingService.getUserRank", () => {
  it("참가한 유저의 순위와 점수를 반환한다", async () => {
    const { service } = createService();
    await service.applyDelta("default", "u1", 10);
    await service.applyDelta("default", "u2", 20);

    expect(await service.getUserRank("default", "u1")).toEqual({ rank: 2, score: 10 });
  });

  it("참가하지 않은 유저는 rank/score 모두 null", async () => {
    const { service } = createService();
    expect(await service.getUserRank("default", "nope")).toEqual({ rank: null, score: null });
  });
});

describe("RankingService.reset", () => {
  it("리더보드를 지우면 이후 조회는 빈 상태가 된다", async () => {
    const { service } = createService();
    await service.applyDelta("default", "u1", 10);
    await service.reset("default");

    expect(await service.getTop("default", 10)).toEqual([]);
    expect(await service.getUserRank("default", "u1")).toEqual({ rank: null, score: null });
  });

  it("다른 leaderboardId는 영향받지 않는다", async () => {
    const { service } = createService();
    await service.applyDelta("default", "u1", 10);
    await service.applyDelta("other", "u1", 99);

    await service.reset("default");

    expect(await service.getUserRank("other", "u1")).toEqual({ rank: 1, score: 99 });
  });
});
