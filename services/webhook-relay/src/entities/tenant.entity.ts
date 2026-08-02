import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

// id는 호출하는 쪽이 randomUUID()로 직접 채운다 — TypeORM의 @BeforeInsert 훅은 실제 엔티티
// 인스턴스(new/repository.create())에만 붙고 plain object를 그대로 save()하면 발동하지
// 않는 특성이 있어서(order-outbox의 OrderEntity와 동일 이유), 여기서도 서비스가 직접 채운다.
@Entity("tenants")
export class TenantEntity {
  @PrimaryColumn("varchar")
  id!: string;

  @Column("varchar")
  name!: string;

  // 테넌트가 ingest API(엔드포인트 등록/이벤트 발행)를 호출할 때 쓰는 인증키.
  // 실무의 JWT 대신 단순 API 키로 충분 — 이 실험의 핵심은 인증이 아니라 배달/circuit breaker.
  @Column("varchar", { unique: true })
  apiKey!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
