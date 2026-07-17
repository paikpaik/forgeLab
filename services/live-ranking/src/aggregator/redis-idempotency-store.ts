import { Injectable } from "@nestjs/common";
import { InjectRedis } from "@paikpaik/node-forge/redis/nestjs";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import type { IdempotencyStore } from "@paikpaik/kafka-forge";
import { idempotencyKey, IDEMPOTENCY_TTL_SECONDS } from "../shared/constants";

// kafka-forge는 IdempotencyStore 인터페이스만 제공하고 구현은 소비 서비스 책임으로 남긴다
// (kafka-forge convention.md — Redis 등 특정 저장소에 의존하지 않기 위함). kafka-forge가 기본
// 제공하는 InMemoryIdempotencyStore는 프로세스가 재시작되면 초기화되므로, "consumer가 크래시
// 후 재시작 → 같은 메시지가 재배달"되는 시나리오에서는 dedup을 못 한다. Redis에 저장하면
// 재시작을 넘어서도 dedup이 유지된다 — 이 실험에서 확인하고 싶었던 지점.
//
// 중복 판정 건수는 여기서 직접 세지 않는다 — kafka-forge 1.0.2부터 StandardConsumer가
// kafka_forge_deduped_total로 표준화해서 잡아준다(proposals/kafka-forge/20260717 반영).
@Injectable()
export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(@InjectRedis() private readonly redis: ForgeRedisClient) {}

  async wasProcessed(key: string): Promise<boolean> {
    return (await this.redis.get(idempotencyKey("score-event", key))) !== null;
  }

  async markProcessed(key: string): Promise<void> {
    await this.redis.set(idempotencyKey("score-event", key), "1", IDEMPOTENCY_TTL_SECONDS);
  }
}
