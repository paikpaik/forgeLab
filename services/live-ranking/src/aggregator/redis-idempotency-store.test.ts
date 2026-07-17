import { describe, it, expect } from "vitest";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import { FakeRedisClient } from "../test-utils/fake-redis-client";
import { RedisIdempotencyStore } from "./redis-idempotency-store";

function createStore() {
  const redis = new FakeRedisClient();
  const store = new RedisIdempotencyStore(redis as unknown as ForgeRedisClient);
  return { store };
}

describe("RedisIdempotencyStore", () => {
  it("처음 보는 키는 wasProcessed가 false", async () => {
    const { store } = createStore();
    expect(await store.wasProcessed("event-1")).toBe(false);
  });

  it("markProcessed 이후에는 같은 키가 wasProcessed true", async () => {
    const { store } = createStore();
    await store.markProcessed("event-1");
    expect(await store.wasProcessed("event-1")).toBe(true);
  });

  it("다른 키는 서로 영향을 주지 않는다", async () => {
    const { store } = createStore();
    await store.markProcessed("event-1");
    expect(await store.wasProcessed("event-2")).toBe(false);
  });
});
