import { randomUUID } from "node:crypto";
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Kafka } from "kafkajs";
import { StandardProducer } from "@paikpaik/kafka-forge";
import { KAFKA_INSTANCE } from "../shared/constants";
import { ScoreEvent } from "../shared/score-event.contract";

@Injectable()
export class ScoreEventProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly producer: StandardProducer;

  constructor(@Inject(KAFKA_INSTANCE) kafka: Kafka) {
    // idempotent: true + maxInFlightRequests: 1 — kafkajs/브로커 레벨에서 네트워크 재시도로
    // 인한 중복 발행을 막는다. 이건 "Kafka가 메시지를 두 번 보내는 것"을 막는 것이고,
    // consumer 쪽 dedupeKey(eventId)는 "같은 이벤트를 두 번 처리하는 것"을 막는 것이라
    // 서로 다른 계층의 멱등성이다.
    this.producer = new StandardProducer(kafka, { idempotent: true, maxInFlightRequests: 1 });
  }

  async onModuleInit(): Promise<void> {
    await this.producer.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.producer.disconnect();
  }

  async submit(
    leaderboardId: string,
    userId: string,
    delta: number,
    eventId?: string,
  ): Promise<{ eventId: string }> {
    const resolvedEventId = eventId ?? randomUUID();
    await this.producer.send(ScoreEvent, { eventId: resolvedEventId, leaderboardId, userId, delta });
    return { eventId: resolvedEventId };
  }
}
