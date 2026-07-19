# kafka-forge 제안 — `IdempotencyStore`에 `release` 추가 (DLQ로 간 메시지는 선점을 되돌림)

## 계기

`services/live-ranking`에서 `claim`(1.0.3)을 붙인 뒤, "DLQ에 쌓인 이벤트를 버그 고치고
재발행하면 다시 처리되는가"를 검토하다가 발견했다. `claim`은 이펙트 실행 *전*에 선점하는데,
그 뒤 재시도까지 다 실패해서 DLQ로 가더라도 그 선점을 되돌리는 코드가 없다.

```ts
// consumer.ts, processMessage()
if (idempotencyStore) {
  const claimed = idempotencyStore.claim
    ? await idempotencyStore.claim(idempotencyKey) // ① 선점 — 성공/실패와 무관하게 참
    : !(await idempotencyStore.wasProcessed(idempotencyKey));
  if (!claimed) { /* 스킵 */ return; }
}

await withConsumerSpan(/* ... */, async () => {
  await this.runWithRetry(event, parsed.data, handler, retry); // ② 재시도 다 실패 → sendToDlq
  consumedTotal.inc(/* ... */);
});
// ③ 여기 어디에도 claim을 되돌리는 코드가 없다
```

한 번도 성공한 적 없는 메시지가 "이미 처리됨"으로 영구히 취급돼서, DLQ 재발행이라는
가장 흔한 운영 패턴이 막힌다.

## 현재 한계

`IdempotencyStore`는 선점(`claim`)과 확인(`wasProcessed`)만 있고, "선점을 취소"하는 메서드가
없다.

```ts
export interface IdempotencyStore {
  wasProcessed(key: string): Promise<boolean>;
  markProcessed(key: string): Promise<void>;
  claim?(key: string): Promise<boolean>;
}
```

## 우회

DLQ 메시지를 재발행할 때 **새 eventId**를 쓰면 된다 — 원본이 확실히 한 번도 성공하지 않았으니
이중 반영 위험이 없다. 다만 이걸 미리 알고 있어야만 가능한 암묵적 우회라, 모르고 그냥
재발행하면 "왜 재처리가 안 되지?"로 헷갈리기 쉽다.

## 제안

`IdempotencyStore`에 선택적 메서드 `release`를 추가하고, `StandardConsumer`가 `runWithRetry`의
성공/실패 결과를 받아서 실패(DLQ행)일 때만 호출한다.

```ts
export interface IdempotencyStore {
  wasProcessed(key: string): Promise<boolean>;
  markProcessed(key: string): Promise<void>;
  claim?(key: string): Promise<boolean>;
  /**
   * (선택) claim으로 선점했지만 결국 처리에 실패해 DLQ로 이동한 경우, 그 선점을 되돌린다.
   * claim을 구현하지 않았으면 호출되지 않는다 — claim 없이는 애초에 선점 자체가 없다.
   */
  release?(key: string): Promise<void>;
}
```

```ts
// consumer.ts — runWithRetry가 성공 여부(boolean)를 반환하도록 바꾼다 (private 메서드,
// 외부에 노출되는 API가 아니라 하위 호환에 영향 없음)
private async runWithRetry(/* ... */): Promise<boolean> {
  if (!retry) {
    try {
      await handler(payload);
      return true;
    } catch (err) {
      consumeErrorsTotal.inc(/* ... */);
      await this.sendToDlq(event, payload, err);
      return false;
    }
  }
  for (let attempt = 1; attempt <= retry.attempts; attempt++) {
    try {
      await handler(payload);
      return true;
    } catch (err) { /* 기존과 동일 */ }
  }
  consumeErrorsTotal.inc(/* ... */);
  await this.sendToDlq(event, payload, lastError);
  return false;
}

// processMessage() — 실패했을 때만 release
await withConsumerSpan(/* ... */, async () => {
  const stopTimer = consumeDurationSeconds.startTimer(/* ... */);
  try {
    const succeeded = await this.runWithRetry(event, parsed.data, handler, retry);
    consumedTotal.inc(/* ... */); // 기존과 동일하게 성공/실패 무관 증가(하위 호환 유지)
    if (!succeeded && idempotencyStore?.claim) {
      await idempotencyStore.release?.(idempotencyKey);
    }
  } finally {
    stopTimer();
  }
});
```

`RedisIdempotencyStore`는 `claim`에 쓴 `lock()`의 키를 그냥 지우면 된다 — node-forge 쪽
변경은 이번에도 불필요하다.

```ts
async release(key: string): Promise<void> {
  await this.redis.del(idempotencyKey("score-event", key));
}
```

`InMemoryIdempotencyStore`도 대칭성을 위해 추가하면 좋다.

```ts
async release(key: string): Promise<void> {
  this.processed.delete(key);
}
```

## 검증 포인트

- fake kafkajs + fake `IdempotencyStore`(`claim`/`release` 구현)로: 핸들러가 계속 실패해서
  DLQ로 가면 `release`가 호출되는지, 그 뒤 같은 키로 다시 `claim`하면 `true`(재선점 가능)를
  반환하는지
- 핸들러가 성공하면 `release`가 호출되지 않는지(성공한 메시지의 선점은 그대로 유지돼야 함 —
  안 그러면 크래시 윈도우 문제가 다시 생김)
- `claim`을 구현하지 않은 `IdempotencyStore`(`release`도 없음)를 넘기면 아무 영향 없는지(하위 호환)
- `consumedTotal` 증가 방식은 이번 제안과 무관하게 그대로 유지(성공/실패 구분 없이 증가) —
  그 부분의 의미가 헷갈린다는 건 별개 이슈(문서화 개선 정도)로 남겨둔다

## 기각한 대안

- **`markProcessed`를 실패 시에도 호출하지 않는 것으로 끝내고 `release` 없이 방치**: 지금
  상태가 정확히 이거다 — 문제를 그대로 두는 것과 같아서 대안이 아니라 현재 상태.
- **DLQ 재발행 시 항상 새 eventId를 쓰도록 강제(문서화만)**: 우회는 되지만, 라이브러리가
  "실패한 메시지는 재처리 가능해야 한다"는 당연한 기대를 스스로 어기고 있다는 근본 문제는
  안 풀린다. 소비 서비스마다 이 규칙을 알아야 하고 안 지키면 조용히 스킵되는 게 위험하다.
