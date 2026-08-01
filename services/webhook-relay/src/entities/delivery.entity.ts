import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

// pending: 아직 최종 결과가 안 남(최초 시도 전이거나, 실패해서 재시도 대기 중)
// success: 2xx 응답을 받아 배달 완료
// dead: MAX_DELIVERY_ATTEMPTS를 넘겨서 더 이상 재시도하지 않음(order-outbox의 dead-lettering과 동일 개념)
export type DeliveryStatus = "pending" | "success" | "dead";

@Entity("deliveries")
export class DeliveryEntity {
  @PrimaryColumn("varchar")
  id!: string;

  @Column("varchar")
  eventId!: string;

  @Column("varchar")
  endpointId!: string;

  @Column("varchar")
  tenantId!: string;

  @Column({ type: "varchar", default: "pending" })
  status!: DeliveryStatus;

  @Column({ type: "int", default: 0 })
  attempts!: number;

  // ISO 문자열 — order-outbox의 publishedAt/confirmedAt과 동일한 이유(드라이버 무관 + 클라이언트가
  // 실제 시각으로 폴링 사이 전이를 재구성 가능). null이면 "재시도 예약 없음"(아직 최초 시도
  // 전이거나, 이미 success/dead로 끝남).
  @Column({ type: "varchar", nullable: true })
  nextAttemptAt!: string | null;

  @Column({ type: "varchar", nullable: true })
  lastAttemptAt!: string | null;

  @Column({ type: "varchar", nullable: true })
  lastError!: string | null;

  @Column({ type: "int", nullable: true })
  responseStatus!: number | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
