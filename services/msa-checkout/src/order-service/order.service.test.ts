import { describe, it, expect, afterEach } from "vitest";
import type { DataSource } from "typeorm";
import { createTestDataSource } from "../test-utils/create-test-data-source";
import { OrderEntity } from "./entities/order.entity";
import { OrderService } from "./order.service";

let dataSource: DataSource;

afterEach(async () => {
  if (dataSource?.isInitialized) await dataSource.destroy();
});

async function setup() {
  dataSource = await createTestDataSource([OrderEntity]);
  return new OrderService(dataSource);
}

describe("OrderService.tryCreateOrder", () => {
  it("주문을 pending 상태로 생성한다", async () => {
    const service = await setup();
    const result = await service.tryCreateOrder("saga-1", "user-1", "widget", 2);

    expect(result.success).toBe(true);
    expect(result.orderId).toBeTruthy();
    const order = await dataSource.getRepository(OrderEntity).findOneBy({ id: result.orderId });
    expect(order).toMatchObject({ status: "PENDING", userId: "user-1", productId: "widget", quantity: 2 });
  });

  it("같은 sagaId로 재시도하면 중복 생성하지 않고 같은 orderId를 반환한다 (멱등성)", async () => {
    const service = await setup();
    const first = await service.tryCreateOrder("saga-1", "user-1", "widget", 2);
    const second = await service.tryCreateOrder("saga-1", "user-1", "widget", 2);

    expect(second.orderId).toBe(first.orderId);
    const count = await dataSource.getRepository(OrderEntity).count();
    expect(count).toBe(1);
  });
});

describe("OrderService.confirmOrder / cancelOrder", () => {
  it("확정하면 상태가 CONFIRMED가 된다", async () => {
    const service = await setup();
    const { orderId } = await service.tryCreateOrder("saga-1", "user-1", "widget", 1);

    const result = await service.confirmOrder("saga-1", orderId!);

    expect(result.success).toBe(true);
    const order = await dataSource.getRepository(OrderEntity).findOneBy({ id: orderId });
    expect(order?.status).toBe("CONFIRMED");
  });

  it("취소하면(보상) 상태가 CANCELLED가 된다", async () => {
    const service = await setup();
    const { orderId } = await service.tryCreateOrder("saga-1", "user-1", "widget", 1);

    const result = await service.cancelOrder("saga-1", orderId!);

    expect(result.success).toBe(true);
    const order = await dataSource.getRepository(OrderEntity).findOneBy({ id: orderId });
    expect(order?.status).toBe("CANCELLED");
  });

  it("존재하지 않는 주문은 실패를 반환한다", async () => {
    const service = await setup();
    const result = await service.confirmOrder("saga-1", "no-such-order");
    expect(result).toMatchObject({ success: false, error: "존재하지 않는 주문입니다" });
  });
});
