import { DataSource } from "typeorm";

// order-outbox에서 검증한 패턴 그대로 — 실제 SQLite in-memory로 TypeORM 로직(원자적
// 조건부 UPDATE 포함)을 검증한다. entities는 서비스마다 다르므로 인자로 받는다.
export async function createTestDataSource(entities: Function[]): Promise<DataSource> {
  const dataSource = new DataSource({
    type: "better-sqlite3",
    database: ":memory:",
    entities,
    synchronize: true,
  });
  await dataSource.initialize();
  return dataSource;
}
