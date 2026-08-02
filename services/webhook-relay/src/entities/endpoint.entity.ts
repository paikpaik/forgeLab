import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

@Entity("endpoints")
export class EndpointEntity {
  @PrimaryColumn("varchar")
  id!: string;

  @Column("varchar")
  tenantId!: string;

  @Column("varchar")
  url!: string;

  // 아웃바운드 페이로드에 HMAC 서명할 때 쓰는 비밀키 — 구독자가 이 값을 미리 공유받아 서명을
  // 검증한다(msa-checkout의 인바운드 JWT 인증과 반대 방향: 여기는 "우리가 보내는 걸 상대가
  // 검증"하는 흐름).
  @Column("varchar")
  secret!: string;

  // simple-json — Postgres jsonb 대신 씀(order-outbox의 payload 컬럼과 동일 이유: 드라이버
  // 무관하게 동작해서 SQLite 인메모리로 유닛테스트 가능). "*"이면 모든 타입 구독.
  @Column({ type: "simple-json" })
  eventTypes!: string[];

  @Column({ type: "boolean", default: true })
  active!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
