import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectDataSource } from "@paikpaik/node-forge/database/nestjs";
import { DataSource, Not, In } from "typeorm";
import { SagaInstanceEntity, SagaStatus } from "./entities/saga-instance.entity";
import { ORDER_CLIENT } from "./clients/order-client";
import type { OrderClient } from "./clients/order-client";
import { INVENTORY_CLIENT } from "./clients/inventory-client";
import type { InventoryClient } from "./clients/inventory-client";

const TERMINAL_STATUSES: SagaStatus[] = ["CONFIRMED", "CANCELLED", "FAILED"];

export interface SagaView {
  found: boolean;
  sagaId: string;
  status: SagaStatus;
  productId: string;
  quantity: number;
  orderId: string | null;
  reservationId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class SagaService {
  private readonly logger = new Logger(SagaService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(ORDER_CLIENT) private readonly orderClient: OrderClient,
    @Inject(INVENTORY_CLIENT) private readonly inventoryClient: InventoryClient,
  ) {}

  async startCheckout(userId: string, productId: string, quantity: number): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.dataSource.getRepository(SagaInstanceEntity).save({
      id,
      userId,
      productId,
      quantity,
      status: "STARTED",
      orderId: null,
      reservationId: null,
      lastError: null,
      updatedAt: now,
    });
    return id;
  }

  async getStatus(sagaId: string): Promise<SagaView | null> {
    const saga = await this.dataSource.getRepository(SagaInstanceEntity).findOneBy({ id: sagaId });
    if (!saga) return null;
    return {
      found: true,
      sagaId: saga.id,
      status: saga.status,
      productId: saga.productId,
      quantity: saga.quantity,
      orderId: saga.orderId,
      reservationId: saga.reservationId,
      lastError: saga.lastError,
      createdAt: saga.createdAt.toISOString(),
      updatedAt: saga.updatedAt,
    };
  }

  async fetchPending(limit: number): Promise<SagaInstanceEntity[]> {
    return this.dataSource.getRepository(SagaInstanceEntity).find({
      where: { status: Not(In(TERMINAL_STATUSES)) },
      order: { createdAt: "ASC" },
      take: limit,
    });
  }

  // saga 하나를 한 단계 전진시킨다. order-outbox 이전 라운드에서 검증된 원칙 —
  // 이 함수를 호출하는 폴러는 saga 하나가 실패해도 나머지 saga 처리를 막으면 안 된다
  // (kafka-forge OutboxPublisher가 겪었던 "배치 중 하나 실패 시 전체 중단" 버그를 반복하지
  // 않기 위해 per-saga try/catch는 호출부(SagaProcessorService)의 책임).
  async driveStep(saga: SagaInstanceEntity): Promise<void> {
    switch (saga.status) {
      case "STARTED":
        await this.tryOrder(saga);
        return;
      case "ORDER_TRIED":
        await this.tryInventory(saga);
        return;
      case "INVENTORY_TRIED":
        await this.confirmBoth(saga);
        return;
      case "COMPENSATING":
        await this.compensate(saga);
        return;
      default:
        return; // 터미널 상태 — fetchPending이 안 뽑아오지만 방어적으로 no-op
    }
  }

  private async tryOrder(saga: SagaInstanceEntity): Promise<void> {
    const result = await this.orderClient.tryCreateOrder(saga.id, saga.userId, saga.productId, saga.quantity);
    if (result.success) {
      await this.transition(saga.id, "ORDER_TRIED", { orderId: result.orderId ?? null });
    } else {
      // order Try는 이 실험에서 실질적으로 실패하지 않지만(자원 제약이 없음), 계약상 실패
      // 케이스도 처리한다 — 아무것도 성공한 게 없으므로 보상 없이 바로 FAILED.
      await this.transition(saga.id, "FAILED", { lastError: result.error ?? "order try 실패" });
    }
  }

  private async tryInventory(saga: SagaInstanceEntity): Promise<void> {
    const result = await this.inventoryClient.tryReserve(saga.id, saga.productId, saga.quantity);
    if (result.success) {
      await this.transition(saga.id, "INVENTORY_TRIED", { reservationId: result.reservationId ?? null });
    } else {
      this.logger.warn(`saga=${saga.id} 재고 예약 실패(${result.error}) → 주문 보상 진행`);
      await this.transition(saga.id, "COMPENSATING", { lastError: result.error ?? "inventory try 실패" });
    }
  }

  private async confirmBoth(saga: SagaInstanceEntity): Promise<void> {
    if (!saga.orderId || !saga.reservationId) {
      // 도달하면 안 되는 상태 — 방어적으로 보상 경로로 보냄
      await this.transition(saga.id, "COMPENSATING", { lastError: "confirm 단계에 필요한 id 누락" });
      return;
    }

    // TCC 원칙: Try가 둘 다 성공했으면 Confirm은 실패해도 되돌리지 않고 재시도한다
    // (여기서 되돌리면 한쪽만 확정되고 한쪽만 취소되는 더 심각한 불일치가 생길 수 있음).
    const [orderResult, inventoryResult] = await Promise.all([
      this.orderClient.confirmOrder(saga.id, saga.orderId),
      this.inventoryClient.confirmReserve(saga.id, saga.reservationId),
    ]);

    if (orderResult.success && inventoryResult.success) {
      await this.transition(saga.id, "CONFIRMED", {});
      return;
    }

    const error = [orderResult.error, inventoryResult.error].filter(Boolean).join(" / ");
    this.logger.warn(`saga=${saga.id} confirm 실패, 다음 tick에 재시도: ${error}`);
    await this.transition(saga.id, "INVENTORY_TRIED", { lastError: error || "confirm 실패" });
  }

  private async compensate(saga: SagaInstanceEntity): Promise<void> {
    if (!saga.orderId) {
      await this.transition(saga.id, "CANCELLED", {});
      return;
    }
    const result = await this.orderClient.cancelOrder(saga.id, saga.orderId);
    if (result.success) {
      await this.transition(saga.id, "CANCELLED", {});
    } else {
      this.logger.warn(`saga=${saga.id} 보상(주문 취소) 실패, 다음 tick에 재시도: ${result.error}`);
      // COMPENSATING 유지 → 다음 폴링에서 재시도
    }
  }

  private async transition(
    sagaId: string,
    status: SagaStatus,
    patch: Partial<Pick<SagaInstanceEntity, "orderId" | "reservationId" | "lastError">>,
  ): Promise<void> {
    await this.dataSource
      .getRepository(SagaInstanceEntity)
      .update(sagaId, { status, updatedAt: new Date().toISOString(), ...patch });
  }
}
