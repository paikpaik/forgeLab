import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import type { Kafka } from "kafkajs";
import { OutboxPublisher } from "@paikpaik/kafka-forge";
import { AdminEventBus } from "@paikpaik/node-forge/events";
import { ADMIN_EVENT_BUS } from "@paikpaik/node-forge/events/nestjs";
import {
  KAFKA_INSTANCE,
  OUTBOX_PUBLISH_BATCH_SIZE,
  OUTBOX_PUBLISH_INTERVAL_MS,
} from "../shared/constants";
import type { AdminLogEvent } from "../shared/admin-log-event";
import { TypeormOutboxStore } from "./typeorm-outbox-store";

// kafka-forge의 OutboxPublisher.publishPending()은 폴링 한 사이클만 수행하고, 스케줄러는
// 내장돼있지 않다 — waiting-room의 AdmissionService(@Interval)와 같은 패턴으로 이 서비스가
// 직접 주기적으로 호출해준다. OrdersService.create()의 트랜잭션과 반드시 같은 DataSource를
// 보는 TypeormOutboxStore를 통해서만 미발행 row를 읽는다.
@Injectable()
export class OutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private readonly publisher: OutboxPublisher;

  constructor(
    @Inject(KAFKA_INSTANCE) kafka: Kafka,
    private readonly store: TypeormOutboxStore,
    @Inject(ADMIN_EVENT_BUS) private readonly adminEvents: AdminEventBus<AdminLogEvent>,
  ) {
    this.publisher = new OutboxPublisher(kafka, this.store, {
      idempotent: true,
      maxInFlightRequests: 1,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.publisher.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.publisher.disconnect();
  }

  @Interval(OUTBOX_PUBLISH_INTERVAL_MS)
  async flush(): Promise<void> {
    const published = await this.publisher.publishPending(OUTBOX_PUBLISH_BATCH_SIZE);
    if (published > 0) {
      this.logger.log(`outbox ${published}건 발행`);
      this.adminEvents.emit({
        type: "published",
        message: `outbox ${published}건 발행됨`,
        at: new Date().toISOString(),
      });
    }
  }
}
