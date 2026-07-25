import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

// STARTED → ORDER_TRIED → INVENTORY_TRIED → CONFIRMED               (해피 패스)
//                              └─(재고 부족 등)→ COMPENSATING → CANCELLED  (보상)
//        └─(order Try 실패, 사실상 발생 안 함)→ FAILED
export type SagaStatus =
  | "STARTED"
  | "ORDER_TRIED"
  | "INVENTORY_TRIED"
  | "CONFIRMED"
  | "COMPENSATING"
  | "CANCELLED"
  | "FAILED";

// 이 테이블이 saga의 유일한 진실. orchestrator가 죽었다 재기동해도, 폴러가 CONFIRMED/
// CANCELLED/FAILED가 아닌 행을 전부 다시 집어서 마지막 상태부터 이어간다 — order-outbox의
// "커밋 전 영속화" 원칙을 saga 단위로 확장한 것.
@Entity("saga_instances")
export class SagaInstanceEntity {
  @PrimaryColumn("varchar")
  id!: string;

  @Column("varchar")
  userId!: string;

  @Column("varchar")
  productId!: string;

  @Column("int")
  quantity!: number;

  @Column({ type: "varchar", default: "STARTED" })
  status!: SagaStatus;

  @Column({ type: "varchar", nullable: true })
  orderId!: string | null;

  @Column({ type: "varchar", nullable: true })
  reservationId!: string | null;

  @Column({ type: "varchar", nullable: true })
  lastError!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @Column("varchar")
  updatedAt!: string;
}
