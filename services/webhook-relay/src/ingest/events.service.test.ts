import { randomUUID } from "node:crypto";
import { describe, it, expect, afterEach } from "vitest";
import type { DataSource } from "typeorm";
import { AdminEventBus } from "@paikpaik/node-forge/events";
import { createTestDataSource } from "../test-utils/create-test-data-source";
import { EndpointEntity } from "../entities/endpoint.entity";
import { DeliveryEntity } from "../entities/delivery.entity";
import { DispatchOutboxRecordEntity } from "../entities/dispatch-outbox-record.entity";
import { EndpointsService } from "./endpoints.service";
import { EventsService } from "./events.service";
import type { AdminLogEvent } from "../shared/admin-log-event";

let dataSource: DataSource;

afterEach(async () => {
  if (dataSource?.isInitialized) await dataSource.destroy();
});

function createServices(ds: DataSource) {
  const endpointsService = new EndpointsService(ds);
  const eventsService = new EventsService(ds, endpointsService, new AdminEventBus<AdminLogEvent>());
  return { endpointsService, eventsService };
}

async function seedEndpoint(ds: DataSource, tenantId: string, eventTypes: string[], active = true) {
  return ds.getRepository(EndpointEntity).save({
    id: randomUUID(),
    tenantId,
    url: "http://example.com/hook",
    secret: "s",
    eventTypes,
    active,
  });
}

describe("EventsService.publish — 트랜잭셔널 아웃박스 fan-out", () => {
  it("이벤트 타입과 일치하는 활성 엔드포인트로만 fan-out된다", async () => {
    dataSource = await createTestDataSource();
    const { eventsService } = createServices(dataSource);
    const tenantId = "t1";
    await seedEndpoint(dataSource, tenantId, ["order.created"]);
    await seedEndpoint(dataSource, tenantId, ["payment.failed"]); // 안 맞음
    await seedEndpoint(dataSource, "other-tenant", ["order.created"]); // 다른 테넌트

    const { deliveryIds } = await eventsService.publish(tenantId, { type: "order.created", payload: {} });
    expect(deliveryIds).toHaveLength(1);
  });

  it("와일드카드(*) 엔드포인트는 모든 타입에 매칭된다", async () => {
    dataSource = await createTestDataSource();
    const { eventsService } = createServices(dataSource);
    await seedEndpoint(dataSource, "t1", ["*"]);

    const { deliveryIds } = await eventsService.publish("t1", { type: "anything.happens", payload: {} });
    expect(deliveryIds).toHaveLength(1);
  });

  it("비활성 엔드포인트는 fan-out 대상에서 빠진다", async () => {
    dataSource = await createTestDataSource();
    const { eventsService } = createServices(dataSource);
    await seedEndpoint(dataSource, "t1", ["order.created"], false);

    const { deliveryIds } = await eventsService.publish("t1", { type: "order.created", payload: {} });
    expect(deliveryIds).toHaveLength(0);
  });

  it("delivery마다 dispatch_outbox_record가 하나씩(같은 트랜잭션으로) 만들어진다", async () => {
    dataSource = await createTestDataSource();
    const { eventsService } = createServices(dataSource);
    await seedEndpoint(dataSource, "t1", ["order.created"]);
    await seedEndpoint(dataSource, "t1", ["order.created"]);

    const { deliveryIds } = await eventsService.publish("t1", { type: "order.created", payload: {} });
    expect(deliveryIds).toHaveLength(2);

    const outboxRows = await dataSource.getRepository(DispatchOutboxRecordEntity).find();
    expect(outboxRows).toHaveLength(2);
    expect(outboxRows.map((r) => r.payload.deliveryId).sort()).toEqual([...deliveryIds].sort());
    expect(outboxRows.every((r) => r.publishedAt === null)).toBe(true);
  });

  it("생성된 delivery는 pending 상태, attempts 0으로 시작한다", async () => {
    dataSource = await createTestDataSource();
    const { eventsService } = createServices(dataSource);
    await seedEndpoint(dataSource, "t1", ["order.created"]);

    await eventsService.publish("t1", { type: "order.created", payload: { x: 1 } });
    const deliveries = await dataSource.getRepository(DeliveryEntity).find();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ status: "pending", attempts: 0, nextAttemptAt: null });
  });

  it("listDeliveries는 해당 이벤트의 delivery만 반환한다", async () => {
    dataSource = await createTestDataSource();
    const { eventsService } = createServices(dataSource);
    await seedEndpoint(dataSource, "t1", ["order.created"]);

    const { eventId } = await eventsService.publish("t1", { type: "order.created", payload: {} });
    await eventsService.publish("t1", { type: "order.created", payload: {} });

    const views = await eventsService.listDeliveries(eventId);
    expect(views).toHaveLength(1);
  });
});
