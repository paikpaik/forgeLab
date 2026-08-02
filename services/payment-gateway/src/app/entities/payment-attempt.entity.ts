import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";
import type { PaymentAttemptOutcome } from "../../shared/constants";

// 성공/거절뿐 아니라 회로차단으로 호출 자체를 안 한 시도, 타임아웃, 웹훅 콜백, 거래조회로
// 해소된 경우까지 전부 남긴다 — live-auction의 REJECTED 입찰 이력과 같은 감사 원칙.
@Entity("payment_attempts")
export class PaymentAttemptEntity {
  @PrimaryColumn("varchar")
  id!: string;

  @Column("varchar")
  paymentId!: string;

  @Column("int")
  attemptNo!: number;

  @Column("varchar")
  outcome!: PaymentAttemptOutcome;

  @Column("int", { nullable: true })
  httpStatus!: number | null;

  @Column("int", { nullable: true })
  durationMs!: number | null;

  @Column("varchar", { nullable: true })
  detail!: string | null;

  @CreateDateColumn()
  at!: Date;
}
