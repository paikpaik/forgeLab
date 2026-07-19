import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

export type OrderStatus = "pending" | "confirmed";

@Entity("orders")
export class OrderEntity {
  // DB 확장(uuid-ossp 등)에도, @BeforeInsert 훅에도 의존하지 않는다 — TypeORM의 라이프사이클
  // 훅은 실제 엔티티 인스턴스(new/repository.create())에만 붙고 plain object를 그대로
  // save()하면 발동하지 않는 특성이 있어서, 호출하는 쪽(OrdersService)이 randomUUID()를
  // 직접 넣어준다. 컬럼 타입도 전부 명시한다 — vitest(esbuild)는 emitDecoratorMetadata를
  // 방출하지 않아서 TypeORM이 타입 추론에 의존하는 바 데코레이터(@Column() 등)를 못 쓴다.
  @PrimaryColumn("varchar")
  id!: string;

  @Column("varchar")
  item!: string;

  @Column("int")
  amount!: number;

  // outbox 폴러가 발행했는지는 OutboxRecordEntity.publishedAt으로 따로 판단한다 — 이 컬럼은
  // "fulfillment가 이 주문을 실제로 처리 완료했는지"만 나타낸다. 둘을 합쳐서 패널에서
  // 생성됨/발행됨/확인됨 3단계를 보여준다.
  @Column({ type: "varchar", default: "pending" })
  status!: OrderStatus;

  @CreateDateColumn()
  createdAt!: Date;

  // outbox_records.publishedAt과 같은 이유로 ISO 문자열(varchar)로 저장 — 폴링이 "발행됨"
  // 상태를 실시간으로 못 잡아도(카프카 발행→소비가 폴링 주기보다 짧게 끝나버려서), 이 실제
  // 시각을 API로 내려주면 클라이언트가 언제 확인됐는지 정확히 재구성할 수 있다.
  @Column({ type: "varchar", nullable: true })
  confirmedAt!: string | null;
}
