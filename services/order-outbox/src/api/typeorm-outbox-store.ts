import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@paikpaik/node-forge/database/nestjs";
import type { DataSource } from "typeorm";
import { IsNull, Not } from "typeorm";
import type { OutboxRecord, OutboxStore } from "@paikpaik/kafka-forge";
import { OUTBOX_MAX_ATTEMPTS } from "../shared/constants";
import { OutboxRecordEntity } from "../entities/outbox-record.entity";

export interface DeadOutboxRecord {
  id: string;
  topic: string;
  key: string;
  attempts: number;
  lastError: string | null;
  deadAt: string | null;
}

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
      // deadAt이 세팅된 레코드는 더 이상 재시도 대상이 아니다 — markFailed에서
      // OUTBOX_MAX_ATTEMPTS를 넘기면 죽은 것으로 표시한다.
      where: { publishedAt: IsNull(), deadAt: IsNull() },
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

  // kafka-forge 1.0.5부터 발행 실패를 이 훅으로 통보받는다(proposals/kafka-forge/20260719
  // -outbox-store-mark-failed-hook.md 반영). "몇 번이면 포기할지"/"포기한 레코드를 어떻게
  // 할지"는 kafka-forge가 관여하지 않는 전적으로 이 store의 정책이다.
  async markFailed(id: string | number, error: unknown): Promise<void> {
    const repo = this.dataSource.getRepository(OutboxRecordEntity);
    const record = await repo.findOneBy({ id: String(id) });
    if (!record) return; // 이미 지워졌거나 없는 레코드 — 조용히 무시

    const attempts = record.attempts + 1;
    const lastError = error instanceof Error ? error.message : String(error);
    const deadAt = attempts >= OUTBOX_MAX_ATTEMPTS ? new Date().toISOString() : null;

    await repo.update(String(id), { attempts, lastError, deadAt });
  }

  async listDead(limit = 20): Promise<{ count: number; recent: DeadOutboxRecord[] }> {
    const repo = this.dataSource.getRepository(OutboxRecordEntity);
    const [count, rows] = await Promise.all([
      repo.count({ where: { deadAt: Not(IsNull()) } }),
      repo.find({
        where: { deadAt: Not(IsNull()) },
        order: { deadAt: "DESC" },
        take: limit,
      }),
    ]);
    return {
      count,
      recent: rows.map((row) => ({
        id: row.id,
        topic: row.topic,
        key: row.key,
        attempts: row.attempts,
        lastError: row.lastError,
        deadAt: row.deadAt,
      })),
    };
  }
}
