import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";
import type { PaymentStatus } from "../../shared/constants";

// clientReference는 PG 호출 "전"에 미리 생성해서 요청에 실어 보낸다 — 타임아웃으로 PG의
// 응답(pgTransactionId 포함)을 못 받아도 reconciler가 조회할 키를 잃지 않기 위함이다.
@Entity("payment_transactions")
export class PaymentTransactionEntity {
  @PrimaryColumn("varchar")
  id!: string;

  @Column("varchar")
  merchantId!: string;

  @Column("varchar", { unique: true })
  idempotencyKey!: string;

  @Column("varchar", { unique: true })
  clientReference!: string;

  @Column("int")
  amount!: number;

  @Column("varchar")
  apiVersion!: string;

  @Column("varchar")
  status!: PaymentStatus;

  @Column("varchar", { nullable: true })
  pgTransactionId!: string | null;

  @Column("int", { default: 0 })
  reconcileAttempts!: number;

  @Column("varchar", { nullable: true })
  lastError!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
