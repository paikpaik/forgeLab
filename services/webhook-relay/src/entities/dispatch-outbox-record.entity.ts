import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

// kafka-forge의 OutboxRecord({ id, topic, key, payload })/OutboxStore 계약을 그대로 만족시키는
// 테이블 — order-outbox와 똑같은 트랜잭셔널 아웃박스 패턴이지만, 코드는 공유하지 않고 이
// 서비스 안에서 새로 구현한다(convention.md — 실험 간 코드 공유 금지). payload는 항상
// `{ deliveryId: string }` 하나뿐이다 — 이 outbox는 "이 Delivery를 최초로 한 번 시도해봐라"는
// 신호를 Kafka로 보내는 용도일 뿐, 실제 배달 상태(성공/재시도/dead)는 DeliveryEntity가 갖는다.
@Entity("dispatch_outbox_records")
export class DispatchOutboxRecordEntity {
  @PrimaryColumn("varchar")
  id!: string;

  @Column("varchar")
  topic!: string;

  @Column("varchar")
  key!: string;

  @Column({ type: "simple-json" })
  payload!: { deliveryId: string };

  @Column({ type: "varchar", nullable: true })
  publishedAt!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
