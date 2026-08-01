import { describe, it, expect, afterEach } from "vitest";
import type { DataSource } from "typeorm";
import { createTestDataSource } from "../test-utils/create-test-data-source";
import { OutboxRecordEntity } from "../entities/outbox-record.entity";
import { OUTBOX_POISON_TOPIC } from "../shared/constants";
import { OrderCreated } from "../shared/order-created.contract";
import { TypeormOutboxStore } from "./typeorm-outbox-store";

let dataSource: DataSource;

afterEach(async () => {
  if (dataSource?.isInitialized) await dataSource.destroy();
});

async function seed(dataSource: DataSource, count: number, publishedCount = 0) {
  const repo = dataSource.getRepository(OutboxRecordEntity);
  for (let i = 0; i < count; i++) {
    await repo.save({
      id: "outbox-" + i,
      topic: "order.created.v1",
      key: "order-" + i,
      payload: { i },
      publishedAt: i < publishedCount ? new Date().toISOString() : null,
    });
  }
}

describe("TypeormOutboxStore.fetchPending", () => {
  it("아무것도 없으면 빈 배열", async () => {
    dataSource = await createTestDataSource();
    const store = new TypeormOutboxStore(dataSource);
    expect(await store.fetchPending(10)).toEqual([]);
  });

  it("미발행 row만 반환한다", async () => {
    dataSource = await createTestDataSource();
    await seed(dataSource, 3, 1); // 0번은 이미 발행됨, 1·2번은 미발행

    const store = new TypeormOutboxStore(dataSource);
    const pending = await store.fetchPending(10);

    expect(pending).toHaveLength(2);
    expect(pending.map((p) => p.key)).toEqual(["order-1", "order-2"]);
  });

  it("limit을 넘는 만큼은 조회하지 않는다", async () => {
    dataSource = await createTestDataSource();
    await seed(dataSource, 5);

    const store = new TypeormOutboxStore(dataSource);
    expect(await store.fetchPending(2)).toHaveLength(2);
  });
});

describe("TypeormOutboxStore.markPublished", () => {
  it("마킹한 row는 이후 fetchPending에서 빠진다", async () => {
    dataSource = await createTestDataSource();
    await seed(dataSource, 3);

    const store = new TypeormOutboxStore(dataSource);
    const pending = await store.fetchPending(10);
    await store.markPublished([pending[0].id]);

    const remaining = await store.fetchPending(10);
    expect(remaining).toHaveLength(2);
    expect(remaining.map((p) => p.id)).not.toContain(pending[0].id);
  });
});

describe("TypeormOutboxStore.markFailed — dead-lettering", () => {
  it("OUTBOX_MAX_ATTEMPTS(5)보다 적게 실패하면 계속 fetchPending에 남는다", async () => {
    dataSource = await createTestDataSource();
    await seed(dataSource, 1);
    const store = new TypeormOutboxStore(dataSource);
    const [record] = await store.fetchPending(10);

    for (let i = 0; i < 4; i++) {
      await store.markFailed(record.id, new Error("boom"));
    }

    expect(await store.fetchPending(10)).toHaveLength(1);
    expect((await store.listDead()).count).toBe(0);
  });

  it("OUTBOX_MAX_ATTEMPTS번째 실패하면 죽은 레코드로 격리되어 fetchPending에서 빠진다", async () => {
    dataSource = await createTestDataSource();
    await seed(dataSource, 2); // order-0(독성), order-1(정상)
    const store = new TypeormOutboxStore(dataSource);
    const [poison] = await store.fetchPending(10);

    for (let i = 0; i < 5; i++) {
      await store.markFailed(poison.id, new Error("invalid topic"));
    }

    const remaining = await store.fetchPending(10);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].key).toBe("order-1"); // 독성만 빠지고 정상은 계속 대상

    const dead = await store.listDead();
    expect(dead.count).toBe(1);
    expect(dead.recent[0]).toMatchObject({ id: poison.id, attempts: 5, lastError: "invalid topic" });
  });

  it("존재하지 않는 id로 markFailed를 호출해도 조용히 무시한다", async () => {
    dataSource = await createTestDataSource();
    const store = new TypeormOutboxStore(dataSource);
    await expect(store.markFailed("no-such-id", new Error("x"))).resolves.toBeUndefined();
  });
});

describe("TypeormOutboxStore.revive", () => {
  it("poison topic으로 죽은 레코드를 되살리면 topic이 정상으로 고쳐지고 다시 fetchPending 대상이 된다", async () => {
    dataSource = await createTestDataSource();
    const repo = dataSource.getRepository(OutboxRecordEntity);
    await repo.save({
      id: "poison-1",
      topic: OUTBOX_POISON_TOPIC,
      key: "order-x",
      payload: {},
      publishedAt: null,
      attempts: 5,
      lastError: "invalid topic",
      deadAt: new Date().toISOString(),
    });
    const store = new TypeormOutboxStore(dataSource);

    const result = await store.revive("poison-1");
    expect(result).toEqual({ revived: true });

    const pending = await store.fetchPending(10);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ id: "poison-1", topic: OrderCreated.topic });
    expect((await store.listDead()).count).toBe(0);
  });

  it("살아있는(죽지 않은) 레코드는 되살릴 대상이 아니라 revived: false", async () => {
    dataSource = await createTestDataSource();
    await seed(dataSource, 1);
    const store = new TypeormOutboxStore(dataSource);
    const [record] = await store.fetchPending(10);

    expect(await store.revive(record.id)).toEqual({ revived: false });
  });

  it("존재하지 않는 id는 revived: false", async () => {
    dataSource = await createTestDataSource();
    const store = new TypeormOutboxStore(dataSource);
    expect(await store.revive("no-such-id")).toEqual({ revived: false });
  });
});
