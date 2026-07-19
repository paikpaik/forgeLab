# kafka-forge 제안 — `IdempotencyStore`에 이펙트 실행 "전" 원자적 선점(`claim`) 추가

## 계기

`services/live-ranking`에서 `RedisIdempotencyStore`를 만든 이유는 "consumer가 크래시 후
재시작 → 같은 메시지가 재배달돼도 점수가 중복 반영되지 않게" 하기 위함이었다. 그런데
`StandardConsumer.processMessage()`의 실행 순서를 다시 보니, 정작 그 시나리오에서 뚫린다는
걸 발견했다.

```ts
// consumer.ts, processMessage()
if (idempotencyStore && (await idempotencyStore.wasProcessed(idempotencyKey))) {
  return; // ① 체크
}

await withConsumerSpan(event.topic, message.key?.toString(), message.headers ?? {}, async () => {
  await this.runWithRetry(event, parsed.data, handler, retry); // ② 이펙트 적용(예: Redis zincrby)
});

if (idempotencyStore) {
  await idempotencyStore.markProcessed(idempotencyKey); // ③ 마킹 — ②가 끝난 "뒤"
}
```

②(이펙트 적용)와 ③(마킹) 사이에 프로세스가 죽으면 — 강제종료든, 컨슈머 그룹 리밸런스로
파티션을 빼앗기든 — 그 메시지의 offset은 아직 커밋되지 않은 상태라 재배달된다. 재배달되면
①에서 `wasProcessed`가 여전히 `false`(마킹이 안 됐으니까)라서 **핸들러가 또 실행되고
이펙트가 또 적용된다** — `IdempotencyStore`가 막아야 하는 정확히 그 상황에서 못 막는다.

같은 문제가 **재시도 경로**에도 있다. Redis 커맨드가 서버에서는 성공했는데 클라이언트가
네트워크 타임아웃으로 실패로 착각하면, `runWithRetry`가 핸들러를 다시 호출해서 이펙트가
두 번 적용될 수 있다.

## 현재 한계

`IdempotencyStore` 인터페이스가 "조회"와 "마킹"을 별개의 메서드로 분리해두고, 마킹을
"핸들러 성공 후"에 호출하도록 강제한다.

```ts
export interface IdempotencyStore {
  wasProcessed(key: string): Promise<boolean>;
  markProcessed(key: string): Promise<void>;
}
```

이 순서(체크 → 이펙트 → 마킹)는 소비 서비스가 `IdempotencyStore`를 어떻게 구현하든
바꿀 수 없다 — 호출 순서 자체가 `StandardConsumer` 내부에 고정되어 있다. Redis `SET NX`처럼
원자적인 저장소를 붙여도, "언제 호출하는지"가 문제라 구현체 쪽에서 손쓸 방법이 없다.

## 우회

없음. `RedisIdempotencyStore`를 아무리 원자적으로 구현해도(예: `SET NX`), `markProcessed`가
이펙트 적용 "후"에만 호출되는 한 이 크래시 윈도우는 항상 남는다.

## 제안

`IdempotencyStore`에 선택적(optional) 메서드 `claim`을 추가한다 — 있으면 `StandardConsumer`가
핸들러 실행 **전**에 원자적으로 선점을 시도하고, 실패하면(이미 다른 곳에서 선점됨) 핸들러를
아예 실행하지 않는다.

```ts
export interface IdempotencyStore {
  wasProcessed(key: string): Promise<boolean>;
  markProcessed(key: string): Promise<void>;
  /**
   * (선택) 원자적으로 "처리 시작"을 선점한다. true를 반환하면 이 호출자가 처음이므로 진행해야
   * 하고, false면 이미 선점(또는 완료)된 상태이므로 핸들러를 실행하지 말아야 한다. 구현되어
   * 있으면 StandardConsumer는 이걸 핸들러 실행 *전*에 호출해서, "이펙트 적용 후 마킹 전"
   * 크래시 윈도우를 없앤다. 구현하지 않으면(하위 호환) 기존 wasProcessed/markProcessed(사후)
   * 방식을 그대로 사용한다.
   */
  claim?(key: string): Promise<boolean>;
}
```

```ts
// consumer.ts, processMessage() — claim이 있으면 우선 사용
if (idempotencyStore) {
  if (idempotencyStore.claim) {
    if (!(await idempotencyStore.claim(idempotencyKey))) {
      dedupedTotal.inc({ topic: event.topic, group: this.groupId });
      return;
    }
  } else if (await idempotencyStore.wasProcessed(idempotencyKey)) {
    dedupedTotal.inc({ topic: event.topic, group: this.groupId });
    return;
  }
}

await withConsumerSpan(/* ... */); // 핸들러 실행

// claim을 쓴 경우엔 이미 선점 시점에 마킹까지 끝난 것이므로 markProcessed를 또 호출하지 않는다.
if (idempotencyStore && !idempotencyStore.claim) {
  await idempotencyStore.markProcessed(idempotencyKey);
}
```

`RedisIdempotencyStore`는 node-forge `ForgeRedisClient.lock()`(`SET NX PX` 기반 분산 락,
`unlock()`은 호출하지 않고 TTL로만 만료시키는 방식으로 재사용)을 그대로 써서 구현 가능하다 —
node-forge 쪽에 새 API가 필요 없다.

```ts
async claim(key: string): Promise<boolean> {
  const token = await this.redis.lock(idempotencyKey("score-event", key), IDEMPOTENCY_TTL_SECONDS);
  return token !== null;
}
```

`InMemoryIdempotencyStore`도 대칭성을 위해 `claim`을 추가하면 좋다 — 실제 I/O 없이 Map
연산만 하므로 별도 원자성 처리 없이 그대로 구현 가능하다.

```ts
async claim(key: string): Promise<boolean> {
  if (await this.wasProcessed(key)) return false;
  await this.markProcessed(key);
  return true;
}
```

## 트레이드오프 (기각한 대안 대신 명시)

`claim`을 이펙트 적용 "전"에 부르면, 핸들러가 실행되기도 전에 "처리됨"으로 표시된다. 만약
그 뒤 프로세스가 (핸들러 완료 전에) 죽으면, 재배달돼도 `claim`이 이미 선점된 상태라 핸들러가
다시 실행되지 않는다 — 즉 이 메시지는 **유실**된다(과소 반영). 지금 문제(크래시 윈도우에서
**중복** 반영)보다 유실 쪽이 리더보드 점수 같은 누적값에는 덜 위험하다고 판단했다(점수가
부풀려지는 것보다 가끔 못 받는 게 낫다). 완벽한 해결(유실도 중복도 없음)은 이펙트 적용과
마킹을 하나의 원자적 트랜잭션으로 묶어야 하는데, 그건 이펙트가 무엇이냐(Redis/DB/외부 API 등)
에 따라 구현이 완전히 달라져서 `StandardConsumer`가 일반화하기 어렵다 — `claim`을 옵션으로
두고 소비 서비스가 자기 이펙트의 특성에 맞게 선택하게 하는 것이 지금 낼 수 있는 가장
실용적인 절충이라고 본다.

## 검증 포인트

- fake kafkajs + fake `IdempotencyStore`(`claim` 구현)로: 핸들러가 실행되기 전에 `claim`이
  호출되는지, `claim`이 `false`를 반환하면 핸들러가 전혀 호출되지 않는지
- `claim`을 구현하지 않은(레거시) `IdempotencyStore`를 넘기면 기존 wasProcessed/markProcessed
  동작이 100% 그대로인지(하위 호환)
- `claim`이 `true`를 반환한 뒤 핸들러가 실행 중 예외를 던져도(재시도 소진 후 DLQ) 다시
  `claim`을 호출하지 않는지(이미 선점된 채로 끝, 재처리는 DLQ 쪽 책임)
