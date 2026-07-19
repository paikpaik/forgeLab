import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Kafka } from "kafkajs";
import { StandardConsumer } from "@paikpaik/kafka-forge";
import { DLQ_CONSUMER_GROUP_ID, KAFKA_INSTANCE } from "../shared/constants";
import { ScoreEventDlq } from "../shared/score-event.contract";
import { DlqLogService } from "./dlq-log.service";

@Injectable()
export class ScoreEventDlqConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScoreEventDlqConsumer.name);
  private readonly consumer: StandardConsumer;

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
      { retry: false },
    );

    await this.consumer.run();
    this.logger.log(`DLQ 구독 시작: ${ScoreEventDlq.topic} (group=${DLQ_CONSUMER_GROUP_ID})`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect();
  }
}
