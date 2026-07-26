import { DataSource } from "typeorm";
import { OrderEntity } from "../entities/order.entity";
import { OutboxRecordEntity } from "../entities/outbox-record.entity";

// 실제 Postgres 없이 in-memory SQLite로 진짜 TypeORM 쿼리(트랜잭션, IsNull, In 등)를 검증한다 —
// TypeORM의 QueryBuilder/Repository API 표면이 넓어서 waiting-room/live-ranking처럼 손으로
// fake를 만드는 대신, 실제로 초기화되는 가벼운 DB를 쓰는 쪽이 훨씬 신뢰할 수 있다.
export async function createTestDataSource(): Promise<DataSource> {
  const dataSource = new DataSource({
    type: "better-sqlite3",
    database: ":memory:",
    entities: [OrderEntity, OutboxRecordEntity],
    synchronize: true,
  });
  await dataSource.initialize();
  return dataSource;
}
