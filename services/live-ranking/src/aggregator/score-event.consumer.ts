import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Kafka } from "kafkajs";
import { StandardConsumer } from "@paikpaik/kafka-forge";
import { AGGREGATOR_CONSUMER_GROUP_ID, KAFKA_INSTANCE } from "../shared/constants";
import { ScoreEvent } from "../shared/score-event.contract";
import { RankingService } from "./ranking.service";
import { RedisIdempotencyStore } from "./redis-idempotency-store";

@Injectable()
export class ScoreEventConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScoreEventConsumer.name);
  private readonly consumer: StandardConsumer;

  constructor(
    @Inject(KAFKA_INSTANCE) kafka: Kafka,
    private readonly rankingService: RankingService,
    private readonly idempotencyStore: RedisIdempotencyStore,
  ) {
    this.consumer = new StandardConsumer(kafka, AGGREGATOR_CONSUMER_GROUP_ID);
  }

  async onModuleInit(): Promise<void> {
    await this.consumer.connect();

    // retry/DLQ는 StandardConsumer가 자체적으로 처리한다(기본 3회 재시도 후
    // ranking.score-events.v1.dlq로 이동) — 여기서 재시도 로직을 따로 만들 필요 없음.
    // dedupeKey를 eventId(비즈니스 키)로 지정 — 기본값인 topic:partition:offset을 쓰면
    // 재배달 시 offset이 달라져서 dedup이 무력화된다.
    await this.consumer.subscribe(
      ScoreEvent,
      async (payload) => {
        await this.rankingService.applyDelta(payload.leaderboardId, payload.userId, payload.delta);
      },
      {
        idempotencyStore: this.idempotencyStore,
        dedupeKey: (payload) => payload.eventId,
      },
    );

    await this.consumer.run();
    this.logger.log(`구독 시작: ${ScoreEvent.topic} (group=${AGGREGATOR_CONSUMER_GROUP_ID})`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect();
  }
}
