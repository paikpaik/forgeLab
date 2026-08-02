import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Kafka } from "kafkajs";
import { StandardConsumer } from "@paikpaik/kafka-forge";
import { DELIVERY_WORKER_CONSUMER_GROUP_ID, KAFKA_INSTANCE } from "../shared/constants";
import { DispatchTrigger } from "../shared/dispatch-event.contract";
import { DeliveryAttemptService } from "./delivery-attempt.service";

// 최초 배달 시도의 트리거. idempotencyStore를 일부러 안 쓴다 — attempt()가 이미
// delivery.status가 'pending'이 아니면 스킵하는 자체 멱등성을 갖고 있어서(여러 인스턴스가
// 같은 deliveryId를 동시에 받아도 안전), kafka-forge의 별도 dedup 계층이 필요 없다.
@Injectable()
export class DispatchConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DispatchConsumer.name);
  private readonly consumer: StandardConsumer;

  constructor(
    @Inject(KAFKA_INSTANCE) kafka: Kafka,
    private readonly deliveryAttemptService: DeliveryAttemptService,
  ) {
    this.consumer = new StandardConsumer(kafka, DELIVERY_WORKER_CONSUMER_GROUP_ID);
  }

  async onModuleInit(): Promise<void> {
    await this.consumer.connect();

    await this.consumer.subscribe(DispatchTrigger, async (payload) => {
      await this.deliveryAttemptService.attempt(payload.deliveryId);
    });

    await this.consumer.run();
    this.logger.log(`구독 시작: ${DispatchTrigger.topic} (group=${DELIVERY_WORKER_CONSUMER_GROUP_ID})`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect();
  }
}
