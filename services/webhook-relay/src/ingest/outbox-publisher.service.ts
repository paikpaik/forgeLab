import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import type { Kafka } from "kafkajs";
import { OutboxPublisher } from "@paikpaik/kafka-forge";
import { KAFKA_INSTANCE, OUTBOX_PUBLISH_BATCH_SIZE, OUTBOX_PUBLISH_INTERVAL_MS } from "../shared/constants";
import { DispatchOutboxStore } from "./dispatch-outbox-store";

// order-outbox의 OutboxPublisherService와 같은 패턴(오늘 그 서비스에서 try/catch 부재로
// 문제를 겪은 걸 알고 있어서, 여기는 처음부터 try/catch를 넣는다) — publishPending()이
// 개별 레코드 실패는 내부에서 흡수하지만, fetchPending()(DB 조회) 실패는 그 밖에서 던진다.
@Injectable()
export class OutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private readonly publisher: OutboxPublisher;

  constructor(
    @Inject(KAFKA_INSTANCE) kafka: Kafka,
    private readonly store: DispatchOutboxStore,
  ) {
    this.publisher = new OutboxPublisher(kafka, this.store, { idempotent: true, maxInFlightRequests: 1 });
  }

  async onModuleInit(): Promise<void> {
    await this.publisher.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.publisher.disconnect();
  }

  @Interval(OUTBOX_PUBLISH_INTERVAL_MS)
  async flush(): Promise<void> {
    try {
      const published = await this.publisher.publishPending(OUTBOX_PUBLISH_BATCH_SIZE);
      if (published > 0) {
        this.logger.log(`dispatch 트리거 ${published}건 발행`);
      }
    } catch (err) {
      this.logger.error(`dispatch 발행 폴링 실패: ${(err as Error).message}`, (err as Error).stack);
    }
  }
}
