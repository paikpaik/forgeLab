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

  // kafka-forge 1.0.3부터 claim이 있으면 StandardConsumer가 핸들러 실행 *전에* 이걸로
  // 원자적으로 선점하고, wasProcessed/markProcessed(사후 마킹)는 더 이상 호출하지 않는다
  // (proposals/kafka-forge/20260717-idempotency-claim-before-effect.md 반영) — "이펙트 적용
  // 후 마킹 전" 크래시 윈도우에서 중복 반영되던 문제가 이걸로 없어진다. 기존에 SET으로 직접
  // 구현했던 걸, 이미 있는 분산 락(SET NX PX, unlock은 호출하지 않고 TTL로만 만료)으로
  // 대체했다 — 원자적 "없을 때만 쓰기"가 필요한 지점이라 lock()의 시맨틱과 정확히 맞는다.
  async claim(key: string): Promise<boolean> {
    const token = await this.redis.lock(idempotencyKey("score-event", key), IDEMPOTENCY_TTL_SECONDS);
    return token !== null;
  }

  // kafka-forge 1.0.4부터, claim으로 선점했지만 재시도까지 다 실패해서 DLQ로 이동하면
  // StandardConsumer가 release를 호출해준다 — 그래야 나중에 버그를 고치고 같은 메시지를
  // 재발행했을 때 "이미 처리됨"으로 영구히 스킵되지 않고 다시 시도할 수 있다
  // (proposals/kafka-forge/20260719-idempotency-release-on-dlq.md 반영). claim에 쓴 락 키를
  // 그냥 지우면 된다 — 성공한 메시지는 release가 호출되지 않으므로 그 선점은 그대로 유지된다.
  async release(key: string): Promise<void> {
    await this.redis.del(idempotencyKey("score-event", key));
  }

  // claim이 있는 한 StandardConsumer는 이제 이 둘을 호출하지 않는다 — 인터페이스가 필수로
  // 요구해서 남겨두지만, 실질적으로는 죽은 코드다. 직접 저장소 상태를 확인하는 테스트/디버깅
  // 용도로는 여전히 쓸 수 있다.
  async wasProcessed(key: string): Promise<boolean> {
    return (await this.redis.get(idempotencyKey("score-event", key))) !== null;
  }

  async markProcessed(key: string): Promise<void> {
    await this.redis.set(idempotencyKey("score-event", key), "1", IDEMPOTENCY_TTL_SECONDS);
  }
}
