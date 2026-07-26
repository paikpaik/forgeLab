import { describe, it, expect, afterEach } from "vitest";
import type { DataSource } from "typeorm";
import { createTestDataSource } from "../test-utils/create-test-data-source";
import { InventoryEntity } from "./entities/inventory.entity";
import { ReservationEntity } from "./entities/reservation.entity";
import { InventoryService } from "./inventory.service";

let dataSource: DataSource;

afterEach(async () => {
  if (dataSource?.isInitialized) await dataSource.destroy();
});

async function setup(total: number) {
  dataSource = await createTestDataSource([InventoryEntity, ReservationEntity]);
  const service = new InventoryService(dataSource);
  await service.seedIfMissing("widget", total);
  return service;
}

describe("InventoryService.tryReserve", () => {
  it("재고가 충분하면 예약에 성공하고 reserved가 증가한다", async () => {
    const service = await setup(10);
    const result = await service.tryReserve("saga-1", "widget", 3);

    expect(result.success).toBe(true);
    expect(result.reservationId).toBeTruthy();
    const stock = await service.getStock("widget");
    expect(stock).toMatchObject({ total: 10, reserved: 3 });
  });

  it("재고가 부족하면 실패하고 아무것도 바뀌지 않는다", async () => {
    const service = await setup(2);
    const result = await service.tryReserve("saga-1", "widget", 3);

    expect(result.success).toBe(false);
    const stock = await service.getStock("widget");
    expect(stock).toMatchObject({ total: 2, reserved: 0 });
  });

  it("재고 1개인 상품에 순차로 두 번 예약 시도하면 하나만 성공한다 (경쟁 조건의 순차 버전)", async () => {
    const service = await setup(1);
    const first = await service.tryReserve("saga-1", "widget", 1);
    const second = await service.tryReserve("saga-2", "widget", 1);

    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
  });

  it("같은 sagaId로 재시도하면 재고를 두 번 깎지 않고 같은 reservationId를 반환한다 (멱등성)", async () => {
    const service = await setup(10);
    const first = await service.tryReserve("saga-1", "widget", 3);
    const second = await service.tryReserve("saga-1", "widget", 3);

    expect(second.success).toBe(true);
    expect(second.reservationId).toBe(first.reservationId);
    const stock = await service.getStock("widget");
    expect(stock).toMatchObject({ reserved: 3 }); // 6이 아니라 3이어야 함
  });

  it("존재하지 않는 상품이면 실패한다", async () => {
    const service = await setup(10);
    const result = await service.tryReserve("saga-1", "no-such-product", 1);
    expect(result).toMatchObject({ success: false, error: "존재하지 않는 상품입니다" });
  });
});

describe("InventoryService.confirmReserve", () => {
  it("확정하면 total과 reserved가 함께 줄어든다", async () => {
    const service = await setup(10);
    const { reservationId } = await service.tryReserve("saga-1", "widget", 3);

    const result = await service.confirmReserve("saga-1", reservationId!);

    expect(result.success).toBe(true);
    const stock = await service.getStock("widget");
    expect(stock).toMatchObject({ total: 7, reserved: 0 });
  });

  it("같은 확정을 재시도해도 두 번 깎이지 않는다 (멱등성)", async () => {
    const service = await setup(10);
    const { reservationId } = await service.tryReserve("saga-1", "widget", 3);
    await service.confirmReserve("saga-1", reservationId!);

    const second = await service.confirmReserve("saga-1", reservationId!);

    expect(second.success).toBe(true);
    const stock = await service.getStock("widget");
    expect(stock).toMatchObject({ total: 7, reserved: 0 });
  });
});

describe("InventoryService.cancelReserve — 보상 트랜잭션", () => {
  it("취소하면 reserved만 풀리고 total은 그대로다", async () => {
    const service = await setup(10);
    const { reservationId } = await service.tryReserve("saga-1", "widget", 3);

    const result = await service.cancelReserve("saga-1", reservationId!);

    expect(result.success).toBe(true);
    const stock = await service.getStock("widget");
    expect(stock).toMatchObject({ total: 10, reserved: 0 });
  });

  it("취소 후 재예약이 가능하다", async () => {
    const service = await setup(1);
    const { reservationId } = await service.tryReserve("saga-1", "widget", 1);
    await service.cancelReserve("saga-1", reservationId!);

    const retry = await service.tryReserve("saga-2", "widget", 1);
    expect(retry.success).toBe(true);
  });

  it("이미 확정된 예약은 취소할 수 없다", async () => {
    const service = await setup(10);
    const { reservationId } = await service.tryReserve("saga-1", "widget", 3);
    await service.confirmReserve("saga-1", reservationId!);

    const result = await service.cancelReserve("saga-1", reservationId!);
    expect(result).toMatchObject({ success: false, error: "이미 확정된 예약은 취소할 수 없습니다" });
  });
});

describe("InventoryService.resetStock", () => {
  it("존재하는 상품의 재고를 강제로 원하는 값으로 되돌린다", async () => {
    const service = await setup(10);
    await service.tryReserve("saga-1", "widget", 5);

    await service.resetStock("widget", 1);

    const stock = await service.getStock("widget");
    expect(stock).toMatchObject({ total: 1, reserved: 0 });
  });
});
