# kafka-forge 제안 — `StandardConsumer`에 멱등성 스킵 카운터 추가

## 계기

`services/live-ranking`의 aggregator는 Kafka 재배달로 인한 중복 반영을 막기 위해
`RedisIdempotencyStore`(`IdempotencyStore` 구현체)를 붙였다. 그런데 이게 실제로 얼마나
걸러내고 있는지 kafka-forge 자체 지표(`kafka_forge_*`)로는 전혀 안 보여서, 저장소
구현 안에서 직접 카운터를 증가시켜 우회했다.

```ts
// 우회 — IdempotencyStore 구현체 안에서 직접 지표를 잰다
async wasProcessed(key: string): Promise<boolean> {
  const seen = (await this.redis.get(idempotencyKey("score-event", key))) !== null;
  if (seen) this.metrics.scoreEventsDeduped.inc(); // 여기서 직접 증가
  return seen;
}
```

## 현재 한계

`consumer.ts`의 `processMessage()`는 `idempotencyStore.wasProcessed()`가 `true`면 콘솔
로그만 남기고 조용히 리턴한다 — 지표 갱신이 없다.

```ts
if (idempotencyStore && (await idempotencyStore.wasProcessed(idempotencyKey))) {
  console.log(`[StandardConsumer] 이미 처리된 메시지, 스킵: ${idempotencyKey}`);
  return; // 여기서 지표 없이 그냥 리턴
}
```

`metrics.ts`에는 `producedTotal`/`produceErrorsTotal`/`consumedTotal`/`consumeErrorsTotal`/
`consumeDurationSeconds`/`consumerLag`만 있고, dedup으로 스킵된 건수를 위한 지표가 없다.

멱등성으로 걸러지는 비율은 `IdempotencyStore` 구현체와 무관하게(Redis든 DB든) 컨슈머
프레임워크가 표준 지표 하나로 보장해줘야 여러 서비스를 같은 대시보드에서 비교할 수 있다 —
지금처럼 구현체마다 각자 다른 이름/라벨로 지표를 만들면 서비스 간 비교가 어렵다.

## 제안

`metrics.ts`에 카운터를 추가하고, `processMessage()`의 dedup-스킵 분기에서 증가시킨다.

```ts
// metrics.ts
export const dedupedTotal = new Counter({
  name: "kafka_forge_deduped_total",
  help: "IdempotencyStore에 의해 중복으로 판정되어 스킵된 메시지 수",
  labelNames: ["topic", "group"],
  registers: [metricsRegistry],
});

// consumer.ts, processMessage() 내부
if (idempotencyStore && (await idempotencyStore.wasProcessed(idempotencyKey))) {
  dedupedTotal.inc({ topic: event.topic, group: this.groupId });
  console.log(`[StandardConsumer] 이미 처리된 메시지, 스킵: ${idempotencyKey}`);
  return;
}
```

## 검증 포인트

- 같은 `dedupeKey`(또는 기본값인 `topic:partition:offset`)로 메시지를 두 번 처리 시도하면
  `kafka_forge_deduped_total{topic,group}`이 정확히 1만큼 증가하는지(첫 처리는
  `consumedTotal`, 두 번째는 `dedupedTotal`)
- `idempotencyStore`를 아예 설정하지 않은 구독은 이 지표가 전혀 증가하지 않는지(라벨
  자체가 생성되지 않아야 함)

## 기각한 대안

- **소비 서비스가 `IdempotencyStore` 구현 안에서 직접 지표를 재는 현재 방식을 그대로
  유지**: 지금 당장은 동작하지만, 구현체(Redis/DB/인메모리)마다 지표 이름·라벨이 달라질
  수 있어서 여러 서비스를 한 대시보드에서 비교하기 어렵다. 프레임워크가 표준 지표 하나로
  통일해서 제공하는 게 장기적으로 일관성 있다.
