import { randomUUID } from "node:crypto";
import { OrderActionResult, OrderClient, TryCreateOrderResult } from "../orchestrator/clients/order-client";

// 실제 order-service를 gRPC로 띄우지 않고도 SagaService를 검증하기 위한 fake.
// waiting-room/live-ranking의 FakeRedisClient와 같은 성격의 테스트 대역.
export class FakeOrderClient implements OrderClient {
  orders = new Map<string, { id: string; status: "PENDING" | "CONFIRMED" | "CANCELLED" }>();
  failTryCreate = false;
  failConfirmOnce = false;
  private confirmFailedOnce = new Set<string>();

  async tryCreateOrder(): Promise<TryCreateOrderResult> {
    if (this.failTryCreate) return { success: false, error: "강제 실패(테스트)" };
    const id = randomUUID();
    this.orders.set(id, { id, status: "PENDING" });
    return { success: true, orderId: id };
  }

  async confirmOrder(sagaId: string, orderId: string): Promise<OrderActionResult> {
    if (this.failConfirmOnce && !this.confirmFailedOnce.has(sagaId)) {
      this.confirmFailedOnce.add(sagaId);
      return { success: false, error: "일시적 실패(테스트)" };
    }
    const order = this.orders.get(orderId);
    if (!order) return { success: false, error: "존재하지 않는 주문입니다" };
    order.status = "CONFIRMED";
    return { success: true };
  }

  async cancelOrder(_sagaId: string, orderId: string): Promise<OrderActionResult> {
    const order = this.orders.get(orderId);
    if (!order) return { success: false, error: "존재하지 않는 주문입니다" };
    order.status = "CANCELLED";
    return { success: true };
  }
}
