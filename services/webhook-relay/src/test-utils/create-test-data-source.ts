import { DataSource } from "typeorm";
import { TenantEntity } from "../entities/tenant.entity";
import { EndpointEntity } from "../entities/endpoint.entity";
import { EventEntity } from "../entities/event.entity";
import { DeliveryEntity } from "../entities/delivery.entity";
import { DispatchOutboxRecordEntity } from "../entities/dispatch-outbox-record.entity";

// 실제 Postgres 없이 in-memory SQLite로 진짜 TypeORM 쿼리(트랜잭션 등)를 검증한다
// (order-outbox의 test-utils와 동일 패턴, 코드는 새로 작성).
export async function createTestDataSource(): Promise<DataSource> {
  const dataSource = new DataSource({
    type: "better-sqlite3",
    database: ":memory:",
    entities: [TenantEntity, EndpointEntity, EventEntity, DeliveryEntity, DispatchOutboxRecordEntity],
    synchronize: true,
  });
  await dataSource.initialize();
  return dataSource;
}
