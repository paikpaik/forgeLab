import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@paikpaik/node-forge/database/nestjs";
import type { DataSource } from "typeorm";
import { IsNull } from "typeorm";
import type { OutboxRecord, OutboxStore } from "@paikpaik/kafka-forge";
import { DispatchOutboxRecordEntity } from "../entities/dispatch-outbox-record.entity";

// kafka-forge의 OutboxStore 계약 구현 — order-outbox의 TypeormOutboxStore와 같은 원리지만
// 코드는 공유하지 않고 이 서비스 안에서 새로 짠다(convention.md). markFailed는 일부러 안
// 만든다 — 이 outbox가 실패해도(Kafka 발행 실패) delivery-worker의 재시도 폴러가
// nextAttemptAt IS NULL인 오래된 pending delivery를 안전망으로 집어가므로, 별도 dead-letter
// 정책이 필요 없다(재시도 폴러 쪽에서 문서화).
@Injectable()
export class DispatchOutboxStore implements OutboxStore {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async fetchPending(limit: number): Promise<OutboxRecord[]> {
    const rows = await this.dataSource.getRepository(DispatchOutboxRecordEntity).find({
      where: { publishedAt: IsNull() },
      order: { createdAt: "ASC" },
      take: limit,
    });
    return rows.map((row) => ({ id: row.id, topic: row.topic, key: row.key, payload: row.payload }));
  }

  async markPublished(ids: Array<string | number>): Promise<void> {
    await this.dataSource
      .getRepository(DispatchOutboxRecordEntity)
      .update(
        ids.map((id) => String(id)),
        { publishedAt: new Date().toISOString() },
      );
  }
}
