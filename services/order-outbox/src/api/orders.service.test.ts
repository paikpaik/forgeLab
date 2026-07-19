import { describe, it, expect, afterEach } from "vitest";
import type { DataSource } from "typeorm";
import { ForgeMetrics } from "@paikpaik/node-forge/metrics";
import { createTestDataSource } from "../test-utils/create-test-data-source";
import { OrderEntity } from "../entities/order.entity";
import { OutboxRecordEntity } from "../entities/outbox-record.entity";
import { OrderCreated } from "../shared/order-created.contract";
import { OUTBOX_POISON_ITEM, OUTBOX_POISON_TOPIC } from "../shared/constants";
import { OrdersService } from "./orders.service";
import { OrdersMetrics } from "./orders.metrics";

let dataSource: DataSource;

afterEach(async () => {
  if (dataSource?.isInitialized) await dataSource.destroy();
});

function createService(ds: DataSource) {
  const metrics = new OrdersMetrics(new ForgeMetrics({ defaultMetrics: false }));
  return { service: new OrdersService(ds, metrics), metrics };
}

describe("OrdersService.create", () => {
  it("주문과 outbox row를 같은 트랜잭션으로 함께 생성한다", async () => {
    dataSource = await createTestDataSource();
    const { service } = createService(dataSource);

    const { id } = await service.create({ item: "키보드", amount: 2 });

    const order = await dataSource.getRepository(OrderEntity).findOneBy({ id });
    expect(order).toMatchObject({ item: "키보드", amount: 2, status: "pending" });

    const outboxRow = await dataSource
      .getRepository(OutboxRecordEntity)
      .findOneBy({ key: id, topic: OrderCreated.topic });
    expect(outboxRow).toMatchObject({ publishedAt: null });
    expect(outboxRow?.payload).toMatchObject({ orderId: id, item: "키보드", amount: 2 });
  });

  it("생성 건수 카운터가 증가한다", async () => {
    dataSource = await createTestDataSource();
    const { service, metrics } = createService(dataSource);

    await service.create({ item: "마우스", amount: 1 });

    const text = await metrics.ordersCreatedTotal.get();
    expect(text.values[0].value).toBe(1);
  });

  it("포이즌 상품명으로 주문하면 outbox row에 일부러 유효하지 않은 토픽을 넣는다", async () => {
    dataSource = await createTestDataSource();
    const { service } = createService(dataSource);

    const { id } = await service.create({ item: OUTBOX_POISON_ITEM, amount: 1 });

    const outboxRow = await dataSource.getRepository(OutboxRecordEntity).findOneBy({ key: id });
    expect(outboxRow?.topic).toBe(OUTBOX_POISON_TOPIC);
  });
});

describe("OrdersService 조회 — 생성됨/발행됨/확인됨 3단계", () => {
  it("outbox가 미발행이면 created, publishedAt/confirmedAt 둘 다 null", async () => {
    dataSource = await createTestDataSource();
    const { service } = createService(dataSource);
    const { id } = await service.create({ item: "키보드", amount: 1 });

    expect(await service.findOne(id)).toMatchObject({
      stage: "created",
      publishedAt: null,
      confirmedAt: null,
    });
  });

  it("outbox가 발행되면(publishedAt 세팅) published, publishedAt이 실제 값으로 노출된다", async () => {
    dataSource = await createTestDataSource();
    const { service } = createService(dataSource);
    const { id } = await service.create({ item: "키보드", amount: 1 });

    const publishedAt = new Date().toISOString();
    await dataSource.getRepository(OutboxRecordEntity).update({ key: id }, { publishedAt });

    expect(await service.findOne(id)).toMatchObject({ stage: "published", publishedAt, confirmedAt: null });
  });

  it("order.status가 confirmed면 confirmed, confirmedAt이 실제 값으로 노출된다 (fulfillment가 반영한 상태)", async () => {
    dataSource = await createTestDataSource();
    const { service } = createService(dataSource);
    const { id } = await service.create({ item: "키보드", amount: 1 });

    const publishedAt = new Date().toISOString();
    const confirmedAt = new Date().toISOString();
    await dataSource.getRepository(OutboxRecordEntity).update({ key: id }, { publishedAt });
    await dataSource.getRepository(OrderEntity).update(id, { status: "confirmed", confirmedAt });

    expect(await service.findOne(id)).toMatchObject({ stage: "confirmed", publishedAt, confirmedAt });
  });

  it("존재하지 않는 주문은 null", async () => {
    dataSource = await createTestDataSource();
    const { service } = createService(dataSource);
    expect(await service.findOne("no-such-id")).toBeNull();
  });
});
