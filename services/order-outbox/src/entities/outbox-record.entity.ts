import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

// kafka-forge의 OutboxRecord({ id, topic, key, payload })와 OutboxStore(fetchPending/
// markPublished) 계약을 그대로 만족시키는 테이블. publishedAt이 null이면 아직 미발행.
// id는 호출하는 쪽(OrdersService)이 randomUUID()로 직접 채운다(@BeforeInsert 훅은 plain
// object save()에서 발동하지 않는 TypeORM 특성 때문에 안 씀 — order.entity.ts 참고).
@Entity("outbox_records")
export class OutboxRecordEntity {
  @PrimaryColumn("varchar")
  id!: string;

  @Column("varchar")
  topic!: string;

  @Column("varchar")
  key!: string;

  // Postgres의 jsonb 대신 simple-json을 쓴다 — payload 안쪽 필드로 쿼리할 일이 없고(항상
  // publishedAt/key로만 조회), simple-json은 드라이버 무관하게(Postgres/SQLite 등) 동일하게
  // JSON.stringify로 저장/파싱돼서 테스트에서 실제 DB(SQLite in-memory) 검증이 가능해진다.
  @Column({ type: "simple-json" })
  payload!: unknown;

  @CreateDateColumn()
  createdAt!: Date;

  // ISO 문자열로 저장한다(Date 타입 컬럼 대신) — Postgres는 "timestamp", SQLite는 "datetime"만
  // 받아들이는 등 드라이버마다 타입 이름이 갈려서, 문자열로 두면 드라이버 무관하게 동일하게
  // 동작한다(테스트에서 SQLite in-memory를 그대로 쓸 수 있는 이유).
  @Column({ type: "varchar", nullable: true })
  publishedAt!: string | null;

  // kafka-forge 1.0.5의 markFailed 훅으로 실패를 통보받으면 이 카운터를 올린다. 몇 번이면
  // 포기할지(OUTBOX_MAX_ATTEMPTS)와 포기한 레코드를 어떻게 할지는 kafka-forge가 아니라
  // 여기 store 쪽 정책이다.
  @Column("int", { default: 0 })
  attempts!: number;

  @Column({ type: "varchar", nullable: true })
  lastError!: string | null;

  // null이 아니면 더 이상 재시도하지 않는 "죽은" 레코드 — fetchPending()이 제외시킨다.
  // 발행 실패가 조용히 무한 재시도되기만 하고 아무 데도 안 보이면 안 되니, GET /outbox/dead로
  // 확인할 수 있게 한다(live-ranking의 DLQ 로그와 같은 관측성 이유).
  @Column({ type: "varchar", nullable: true })
  deadAt!: string | null;
}
