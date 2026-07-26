import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@paikpaik/node-forge/database/nestjs";
import { DataSource } from "typeorm";
import { InventoryEntity } from "./entities/inventory.entity";
import { ReservationEntity } from "./entities/reservation.entity";

export interface TryReserveResult {
  success: boolean;
  reservationId?: string;
  error?: string;
}

export interface ActionResult {
  success: boolean;
  error?: string;
}

@Injectable()
export class InventoryService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async tryReserve(sagaId: string, productId: string, quantity: number): Promise<TryReserveResult> {
    const reservationRepo = this.dataSource.getRepository(ReservationEntity);

    // 멱등성: orchestrator가 네트워크 오류 후 같은 sagaId로 재시도해도 재고를 두 번 안 깎는다.
    const existing = await reservationRepo.findOneBy({ sagaId });
    if (existing) {
      return existing.status === "CANCELLED"
        ? { success: false, error: "이미 취소된 예약입니다" }
        : { success: true, reservationId: existing.id };
    }

    // 원자적 조건부 UPDATE — SELECT 후 애플리케이션에서 조건 검사하는 2단계 방식은 TOCTOU라
    // 다중 인스턴스 상황에서 재고가 마이너스로 내려갈 수 있어 반드시 이 형태로 구현한다.
    const updateResult = await this.dataSource
      .createQueryBuilder()
      .update(InventoryEntity)
      .set({ reserved: () => "reserved + :qty" })
      .where("productId = :productId AND total - reserved >= :qty", { productId, qty: quantity })
      .execute();

    if ((updateResult.affected ?? 0) === 0) {
      const product = await this.dataSource.getRepository(InventoryEntity).findOneBy({ productId });
      const error = product ? "재고가 부족합니다" : "존재하지 않는 상품입니다";
      return { success: false, error };
    }

    const reservationId = randomUUID();
    await reservationRepo.save({ id: reservationId, sagaId, productId, quantity, status: "RESERVED" });
    return { success: true, reservationId };
  }

  async confirmReserve(sagaId: string, reservationId: string): Promise<ActionResult> {
    const reservationRepo = this.dataSource.getRepository(ReservationEntity);
    const reservation = await reservationRepo.findOneBy({ id: reservationId, sagaId });
    if (!reservation) return { success: false, error: "존재하지 않는 예약입니다" };
    if (reservation.status === "CONFIRMED") return { success: true }; // 재시도 멱등
    if (reservation.status === "CANCELLED") return { success: false, error: "이미 취소된 예약입니다" };

    await this.dataSource
      .createQueryBuilder()
      .update(InventoryEntity)
      .set({ total: () => "total - :qty", reserved: () => "reserved - :qty" })
      .where("productId = :productId", { productId: reservation.productId, qty: reservation.quantity })
      .execute();
    await reservationRepo.update(reservationId, { status: "CONFIRMED" });
    return { success: true };
  }

  async cancelReserve(sagaId: string, reservationId: string): Promise<ActionResult> {
    const reservationRepo = this.dataSource.getRepository(ReservationEntity);
    const reservation = await reservationRepo.findOneBy({ id: reservationId, sagaId });
    if (!reservation) return { success: false, error: "존재하지 않는 예약입니다" };
    if (reservation.status === "CANCELLED") return { success: true }; // 재시도 멱등
    if (reservation.status === "CONFIRMED") return { success: false, error: "이미 확정된 예약은 취소할 수 없습니다" };

    await this.dataSource
      .createQueryBuilder()
      .update(InventoryEntity)
      .set({ reserved: () => "reserved - :qty" })
      .where("productId = :productId", { productId: reservation.productId, qty: reservation.quantity })
      .execute();
    await reservationRepo.update(reservationId, { status: "CANCELLED" });
    return { success: true };
  }

  // 테스트/데모 전용 — 다중 인스턴스 경쟁 시나리오를 재현하려면 재고를 원하는 수치로
  // 언제든 되돌릴 수 있어야 한다. seedIfMissing()과 달리 이미 있어도 강제로 덮어쓴다.
  async resetStock(productId: string, total: number): Promise<ActionResult> {
    await this.dataSource
      .getRepository(InventoryEntity)
      .upsert({ productId, total, reserved: 0 }, ["productId"]);
    return { success: true };
  }

  async seedIfMissing(productId: string, total: number): Promise<void> {
    const repo = this.dataSource.getRepository(InventoryEntity);
    const exists = await repo.existsBy({ productId });
    if (exists) return;
    try {
      await repo.insert({ productId, total, reserved: 0 });
    } catch {
      // 다중 인스턴스가 동시에 부팅하면서 둘 다 시드를 시도할 수 있음 — 먼저 성공한 쪽만
      // 이기면 되므로 나머지 인스턴스의 실패(중복 PK)는 무시한다.
    }
  }

  async getStock(productId: string): Promise<{ found: boolean; total: number; reserved: number }> {
    const product = await this.dataSource.getRepository(InventoryEntity).findOneBy({ productId });
    if (!product) return { found: false, total: 0, reserved: 0 };
    return { found: true, total: product.total, reserved: product.reserved };
  }
}
