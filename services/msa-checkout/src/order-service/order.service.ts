import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@paikpaik/node-forge/database/nestjs";
import { DataSource } from "typeorm";
import { OrderEntity } from "./entities/order.entity";

export interface TryCreateOrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
}

export interface ActionResult {
  success: boolean;
  error?: string;
}

@Injectable()
export class OrderService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async tryCreateOrder(
    sagaId: string,
    userId: string,
    productId: string,
    quantity: number,
  ): Promise<TryCreateOrderResult> {
    const repo = this.dataSource.getRepository(OrderEntity);

    // 멱등성: orchestrator가 같은 sagaId로 재시도해도 주문이 중복 생성되지 않는다.
    const existing = await repo.findOneBy({ sagaId });
    if (existing) return { success: true, orderId: existing.id };

    const id = randomUUID();
    await repo.save({ id, sagaId, userId, productId, quantity, status: "PENDING" });
    return { success: true, orderId: id };
  }

  async confirmOrder(sagaId: string, orderId: string): Promise<ActionResult> {
    const repo = this.dataSource.getRepository(OrderEntity);
    const order = await repo.findOneBy({ id: orderId, sagaId });
    if (!order) return { success: false, error: "존재하지 않는 주문입니다" };
    if (order.status === "CANCELLED") return { success: false, error: "이미 취소된 주문입니다" };

    await repo.update(orderId, { status: "CONFIRMED" });
    return { success: true };
  }

  async cancelOrder(sagaId: string, orderId: string): Promise<ActionResult> {
    const repo = this.dataSource.getRepository(OrderEntity);
    const order = await repo.findOneBy({ id: orderId, sagaId });
    if (!order) return { success: false, error: "존재하지 않는 주문입니다" };

    await repo.update(orderId, { status: "CANCELLED" });
    return { success: true };
  }
}
