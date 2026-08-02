import { DataSource } from "typeorm";
import { AuctionEntity } from "../auction/entities/auction.entity";
import { BidEntity } from "../auction/entities/bid.entity";

// 실제 Postgres 없이 in-memory SQLite로 진짜 TypeORM 쿼리(트랜잭션, 조건부 UPDATE 등)를
// 검증한다 — order-outbox/msa-checkout과 동일한 패턴.
export async function createTestDataSource(): Promise<DataSource> {
  const dataSource = new DataSource({
    type: "better-sqlite3",
    database: ":memory:",
    entities: [AuctionEntity, BidEntity],
    synchronize: true,
  });
  await dataSource.initialize();
  return dataSource;
}
