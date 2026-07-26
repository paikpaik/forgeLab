import { describe, it, expect, afterEach } from "vitest";
import type { DataSource } from "typeorm";
import { createTestDataSource } from "../test-utils/create-test-data-source";
import { FakeOrderClient } from "../test-utils/fake-order-client";
import { FakeInventoryClient } from "../test-utils/fake-inventory-client";
import { SagaInstanceEntity } from "./entities/saga-instance.entity";
import { SagaService } from "./saga.service";

let dataSource: DataSource;

afterEach(async () => {
  if (dataSource?.isInitialized) await dataSource.destroy();
});

async function setup() {
  dataSource = await createTestDataSource([SagaInstanceEntity]);
  const orderClient = new FakeOrderClient();
  const inventoryClient = new FakeInventoryClient();
  const service = new SagaService(dataSource, orderClient, inventoryClient);
  return { service, orderClient, inventoryClient };
}

async function driveUntilTerminal(service: SagaService, sagaId: string, maxTicks = 10) {
  for (let i = 0; i < maxTicks; i++) {
    const view = await service.getStatus(sagaId);
    if (!view) throw new Error("saga not found");
    if (["CONFIRMED", "CANCELLED", "FAILED"].includes(view.status)) return view;
    const [saga] = await service.fetchPending(1);
    await service.driveStep(saga);
  }
  throw new Error("터미널 상태에 도달하지 못함");
}

describe("SagaService — 해피 패스", () => {
  it("STARTED → ORDER_TRIED → INVENTORY_TRIED → CONFIRMED 순서로 전진한다", async () => {
    const { service } = await setup();
    const sagaId = await service.startCheckout("user-1", "widget", 2);

    const view = await driveUntilTerminal(service, sagaId);

    expect(view.status).toBe("CONFIRMED");
    expect(view.orderId).toBeTruthy();
    expect(view.reservationId).toBeTruthy();
  });

  it("한 단계 전진할 때마다 status가 바뀌고 updatedAt이 유효한 ISO 문자열로 채워진다", async () => {
    const { service } = await setup();
    const sagaId = await service.startCheckout("user-1", "widget", 1);

    const [saga] = await service.fetchPending(1);
    await service.driveStep(saga);

    const view = await service.getStatus(sagaId);
    expect(view!.status).toBe("ORDER_TRIED");
    expect(() => new Date(view!.updatedAt).toISOString()).not.toThrow();
  });
});

describe("SagaService — 보상 트랜잭션 (재고 부족)", () => {
  it("inventory try 실패 시 COMPENSATING → CANCELLED로 가고, 주문이 취소된다", async () => {
    const { service, orderClient, inventoryClient } = await setup();
    inventoryClient.failTryReserve = true;
    const sagaId = await service.startCheckout("user-1", "widget", 1);

    const view = await driveUntilTerminal(service, sagaId);

    expect(view.status).toBe("CANCELLED");
    expect(view.orderId).toBeTruthy();
    expect(orderClient.orders.get(view.orderId!)?.status).toBe("CANCELLED");
    expect(view.reservationId).toBeNull(); // 재고 예약은 애초에 성공한 적이 없음
  });
});

describe("SagaService — confirm 부분 실패는 되돌리지 않고 재시도한다", () => {
  it("confirm이 한 번 실패해도 결국 CONFIRMED로 수렴한다 (보상하지 않음)", async () => {
    const { service, orderClient } = await setup();
    orderClient.failConfirmOnce = true;
    const sagaId = await service.startCheckout("user-1", "widget", 1);

    const view = await driveUntilTerminal(service, sagaId);

    expect(view.status).toBe("CONFIRMED");
  });
});

describe("SagaService.fetchPending — 크래시 복구의 근거", () => {
  it("터미널 상태가 아닌 saga만 반환한다 (재기동 후 이어서 처리할 대상)", async () => {
    const { service } = await setup();
    const confirmed = await service.startCheckout("user-1", "widget", 1);
    await driveUntilTerminal(service, confirmed);
    const stuck = await service.startCheckout("user-2", "widget", 1);

    const pending = await service.fetchPending(10);

    expect(pending.map((s) => s.id)).toEqual([stuck]);
  });

  it("여러 saga 중 하나가 처리 도중이어도 나머지는 독립적으로 fetchPending에 포함된다", async () => {
    const { service } = await setup();
    const a = await service.startCheckout("user-1", "widget", 1);
    const b = await service.startCheckout("user-2", "widget", 1);

    const pending = await service.fetchPending(10);

    expect(pending.map((s) => s.id).sort()).toEqual([a, b].sort());
  });
});
