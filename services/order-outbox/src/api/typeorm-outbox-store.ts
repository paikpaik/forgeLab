import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@paikpaik/node-forge/database/nestjs";
import type { DataSource } from "typeorm";
import { IsNull } from "typeorm";
import type { OutboxRecord, OutboxStore } from "@paikpaik/kafka-forge";
import { OutboxRecordEntity } from "../entities/outbox-record.entity";

// kafka-forge는 OutboxStore 인터페이스만 제공하고 구현은 소비 서비스 책임으로 남긴다 —
// Redis/DB 등 특정 저장소에 의존하지 않기 위함(kafka-forge convention.md). 여기서는
// Postgres(TypeORM)로 구현한다. fetchPending/markPublished 둘 다 OutboxPublisherService가
// 주문 API와 "같은" DataSource를 통해 호출해야, 같은 트랜잭션에서 커밋된 row를 곧바로
// 읽을 수 있다.
@Injectable()
export class TypeormOutboxStore implements OutboxStore {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async fetchPending(limit: number): Promise<OutboxRecord[]> {
    const rows = await this.dataSource.getRepository(OutboxRecordEntity).find({
      where: { publishedAt: IsNull() },
      order: { createdAt: "ASC" },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      topic: row.topic,
      key: row.key,
      payload: row.payload,
    }));
  }

  async markPublished(ids: Array<string | number>): Promise<void> {
    // OutboxRecordEntity.id는 항상 uuid(string)다 — kafka-forge의 OutboxRecord.id 타입이
    // string | number라 여기서 문자열로 좁혀준다.
    await this.dataSource.getRepository(OutboxRecordEntity).update(
      ids.map((id) => String(id)),
      { publishedAt: new Date().toISOString() },
    );
  }
}
