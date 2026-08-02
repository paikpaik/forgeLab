import { DataSource } from "typeorm";
import { PaymentTransactionEntity } from "../app/entities/payment-transaction.entity";
import { PaymentAttemptEntity } from "../app/entities/payment-attempt.entity";

// 실제 Postgres 없이 in-memory SQLite로 진짜 TypeORM 쿼리를 검증한다 — 다른 실험과 동일한 패턴.
export async function createTestDataSource(): Promise<DataSource> {
  const dataSource = new DataSource({
    type: "better-sqlite3",
    database: ":memory:",
    entities: [PaymentTransactionEntity, PaymentAttemptEntity],
    synchronize: true,
  });
  await dataSource.initialize();
  return dataSource;
}
