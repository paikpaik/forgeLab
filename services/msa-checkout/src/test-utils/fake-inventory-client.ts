import { randomUUID } from "node:crypto";
import { InventoryActionResult, InventoryClient, TryReserveResult } from "../orchestrator/clients/inventory-client";

export class FakeInventoryClient implements InventoryClient {
  reservations = new Map<string, { id: string; status: "RESERVED" | "CONFIRMED" | "CANCELLED" }>();
  failTryReserve = false;

  async tryReserve(): Promise<TryReserveResult> {
    if (this.failTryReserve) return { success: false, error: "재고가 부족합니다" };
    const id = randomUUID();
    this.reservations.set(id, { id, status: "RESERVED" });
    return { success: true, reservationId: id };
  }

  async confirmReserve(_sagaId: string, reservationId: string): Promise<InventoryActionResult> {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) return { success: false, error: "존재하지 않는 예약입니다" };
    reservation.status = "CONFIRMED";
    return { success: true };
  }

  async cancelReserve(_sagaId: string, reservationId: string): Promise<InventoryActionResult> {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) return { success: false, error: "존재하지 않는 예약입니다" };
    reservation.status = "CANCELLED";
    return { success: true };
  }
}
