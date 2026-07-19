import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Kafka } from "kafkajs";
import { InMemoryIdempotencyStore, StandardConsumer } from "@paikpaik/kafka-forge";
import { DLQ_CONSUMER_GROUP_ID, KAFKA_INSTANCE } from "../shared/constants";
import { ScoreEventDlq } from "../shared/score-event.contract";
import { DlqLogService } from "./dlq-log.service";

@Injectable()
export class ScoreEventDlqConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScoreEventDlqConsumer.name);
  private readonly consumer: StandardConsumer;
  // 이 컨슈머는 "확인용 로그에 같은 실패를 두 번 안 남기기"만 하면 되는 수준이라, Redis처럼
  // 재시작을 넘어 살아남는 멱등성까지는 필요 없다 — kafka-forge 기본 제공 구현으로 충분하다
  // (RedisIdempotencyStore가 왜 필요했는지와 대비되는 지점). 1.0.4의 claim/release도 이미
  // 구현돼 있어서 그대로 이득을 본다.
  private readonly dedupStore = new InMemoryIdempotencyStore({ ttlMs: 60_000 });

  constructor(
    @Inject(KAFKA_INSTANCE) kafka: Kafka,
    private readonly dlqLogService: DlqLogService,
  ) {
    this.consumer = new StandardConsumer(kafka, DLQ_CONSUMER_GROUP_ID);
  }

  async onModuleInit(): Promise<void> {
    await this.consumer.connect();

    // retry: false — 여기서 핸들러가 던지면 kafka-forge가 "이 DLQ 토픽의 DLQ"
    // (...v1.dlq.dlq)로 다시 보내려 하는데, 그 이름이 kafka-forge 자신의 토픽 네이밍
    // 컨벤션을 어겨서 assertValidTopicName이 던진다 — 그래서 절대 밖으로 던지지 않고
    // 여기서 로그만 남기고 삼킨다.
    await this.consumer.subscribe(
      ScoreEventDlq,
      async (envelope) => {
        try {
          await this.dlqLogService.record({
            userId: envelope.payload.userId,
            leaderboardId: envelope.payload.leaderboardId,
            delta: envelope.payload.delta,
            error: envelope.error,
            failedAt: envelope.failedAt,
          });
        } catch (err) {
          this.logger.error(`DLQ 기록 실패: ${(err as Error).message}`);
        }
      },
      { retry: false, idempotencyStore: this.dedupStore },
    );

    await this.consumer.run();
    this.logger.log(`DLQ 구독 시작: ${ScoreEventDlq.topic} (group=${DLQ_CONSUMER_GROUP_ID})`);
  }

  async onModuleDestroy(): Promise<void> {
    this.dedupStore.stop();
    await this.consumer.disconnect();
  }
}
