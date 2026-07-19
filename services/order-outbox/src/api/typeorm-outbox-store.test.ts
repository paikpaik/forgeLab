import { describe, it, expect, afterEach } from "vitest";
import type { DataSource } from "typeorm";
import { createTestDataSource } from "../test-utils/create-test-data-source";
import { OutboxRecordEntity } from "../entities/outbox-record.entity";
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
