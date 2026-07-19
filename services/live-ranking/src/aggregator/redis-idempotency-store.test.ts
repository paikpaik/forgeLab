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

describe("RedisIdempotencyStore.claim", () => {
  it("처음 선점하면 true", async () => {
    const { store } = createStore();
    expect(await store.claim("event-1")).toBe(true);
  });

  it("같은 키를 두 번째 선점하면 false — 이펙트를 두 번 실행하지 않게 막는 지점", async () => {
    const { store } = createStore();
    expect(await store.claim("event-1")).toBe(true);
    expect(await store.claim("event-1")).toBe(false);
    expect(await store.claim("event-1")).toBe(false);
  });

  it("다른 키는 독립적으로 선점 가능", async () => {
    const { store } = createStore();
    expect(await store.claim("event-1")).toBe(true);
    expect(await store.claim("event-2")).toBe(true);
  });
});

describe("RedisIdempotencyStore.release", () => {
  it("release 이후에는 같은 키를 다시 선점할 수 있다 — DLQ 재발행 시 재처리가 막히지 않아야 함", async () => {
    const { store } = createStore();
    expect(await store.claim("event-1")).toBe(true);
    await store.release("event-1");
    expect(await store.claim("event-1")).toBe(true);
  });

  it("release 안 하면 계속 선점된 상태로 남는다", async () => {
    const { store } = createStore();
    expect(await store.claim("event-1")).toBe(true);
    expect(await store.claim("event-1")).toBe(false);
  });
});
