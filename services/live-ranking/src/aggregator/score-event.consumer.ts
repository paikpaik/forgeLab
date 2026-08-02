import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Kafka } from "kafkajs";
import { StandardConsumer } from "@paikpaik/kafka-forge";
import {
  AGGREGATOR_CONSUMER_GROUP_ID,
  CRASH_TEST_DELAY_MS,
  CRASH_TEST_USER_ID,
  DLQ_TEST_USER_ID,
  KAFKA_INSTANCE,
} from "../shared/constants";
import { ScoreEvent } from "../shared/score-event.contract";
import { RankingService } from "./ranking.service";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class ScoreEventConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScoreEventConsumer.name);
  private readonly consumer: StandardConsumer;

  constructor(
    @Inject(KAFKA_INSTANCE) kafka: Kafka,
    private readonly rankingService: RankingService,
  ) {
    this.consumer = new StandardConsumer(kafka, AGGREGATOR_CONSUMER_GROUP_ID);
  }

  async onModuleInit(): Promise<void> {
    await this.consumer.connect();

    // retry/DLQ는 StandardConsumer가 자체적으로 처리한다(기본 3회 재시도 후
    // ranking.score-events.v1.dlq로 이동) — 여기서 재시도 로직을 따로 만들 필요 없음.
    //
    // idempotencyStore/dedupeKey를 여기서 더 이상 안 쓴다 — kafka-forge의 claim()은
    // "핸들러 실행 *전에* 선점"만 해주고, 핸들러 안의 이펙트 적용은 별개 호출이라 그 사이에
    // 크래시가 나면 "선점은 됐는데 이펙트는 영구 유실"되는 버그가 있었다(2026-08-01 실제
    // docker kill로 재현, ARCHITECTURE.md 참고). claim과 이펙트를 하나의 Redis 호출로
    // 원자화하려면 이펙트가 뭔지(zincrby+키+델타)를 알아야 하는데, kafka-forge는 그걸
    // 일부러 모른다(스토리지/도메인 비의존 원칙) — 그래서 이 원자화는 kafka-forge가 아니라
    // RankingService.applyDeltaOnce()가 직접 한다.
    await this.consumer.subscribe(ScoreEvent, async (payload) => {
      // panel.html의 "DLQ 테스트" 버튼이 이 userId로 이벤트를 보낸다 — DLQ가 실제로
      // 채워지는 걸 눈으로 보려면 재현 가능하게 실패시킬 방법이 필요해서 만든 테스트 훅.
      if (payload.userId === DLQ_TEST_USER_ID) {
        throw new Error(`DLQ 테스트용 강제 실패 (userId=${DLQ_TEST_USER_ID})`);
      }
      // panel.html의 "크래시 윈도우 재현" 버튼이 이 userId로 이벤트를 보낸다 — 이펙트 적용
      // 직전에 일부러 지연을 둬서, 그 사이 docker kill로 죽여도 데이터가 안전한지(원자화
      // 이후에는 재배달 시 정확히 한 번만 반영됨) 실제로 확인할 수 있게 한다.
      if (payload.userId === CRASH_TEST_USER_ID) {
        this.logger.warn(`크래시 테스트: 이펙트 적용 전 ${CRASH_TEST_DELAY_MS}ms 지연 시작`);
        await delay(CRASH_TEST_DELAY_MS);
      }
      await this.rankingService.applyDeltaOnce(
        payload.leaderboardId,
        payload.userId,
        payload.delta,
        payload.eventId,
      );
    });

    await this.consumer.run();
    this.logger.log(`구독 시작: ${ScoreEvent.topic} (group=${AGGREGATOR_CONSUMER_GROUP_ID})`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect();
  }
}
