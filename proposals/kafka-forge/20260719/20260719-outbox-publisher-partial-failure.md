# kafka-forge 제안 — `OutboxPublisher.publishPending()`이 배치 중 하나 실패해도 나머지를 계속 처리하게

## 계기

`services/order-outbox`에서 outbox 테이블에 정상 레코드 → 잘못된 토픽명의 레코드(독성) →
정상 레코드를 시각 순서대로 직접 삽입하고 폴러를 돌려서 **실제로 재현**했다. 결과는
이론보다 훨씬 심각했다.

- `kafka_forge_produced_total`이 5분 사이 5회 증가 — **첫 번째 정상 레코드가 매 5초 폴링마다
  계속 중복 발행**됐다(한 번도 `markPublished`가 안 불려서)
- `kafka_forge_produce_errors_total{topic="invalid topic name!!!"}`이 9회 증가 — 독성
  레코드가 백오프 없이 매번 재시도됐다
- **세 번째 정상 레코드는 재현 기간 내내 단 한 번도 발행되지 않았다** — 독성 레코드 뒤에
  있다는 이유만으로

## 현재 한계

```ts
async publishPending(limit = 50): Promise<number> {
  const pending = await this.store.fetchPending(limit);
  const publishedIds: Array<string | number> = [];

  for (const record of pending) {
    try {
      await withProducerSpan(record.topic, record.key, async (traceHeaders) => {
        await this.producer.send({ topic: record.topic, messages: [/* ... */] });
      });
      producedTotal.inc({ topic: record.topic });
      publishedIds.push(record.id);
    } catch (err) {
      produceErrorsTotal.inc({ topic: record.topic });
      throw err; // ← 여기서 즉시 던져서 루프를 빠져나간다
    }
  }

  if (publishedIds.length > 0) {
    await this.store.markPublished(publishedIds); // ← throw 때문에 여기 도달 못 함
  }

  return publishedIds.length;
}
```

배치 중 레코드 하나라도 실패하면 그 자리에서 `throw`하는데, `markPublished()` 호출이 루프
**뒤**에 있어서 (1) 그 전에 이미 Kafka 발행에 성공한 레코드들도 커밋을 못 받고 다음 폴링에서
**중복 발행**되고, (2) 그 뒤에 남은 레코드들은 **시도조차** 되지 않는다. 독성 레코드 하나가
그 뒤에 쌓인 모든 outbox 레코드의 발행을 영구히 막는 헤드-오프-라인 블로킹이다.

## 우회

없음 — `OutboxPublisher`가 라이브러리 내부에서 순회하는 로직이라 소비 서비스 쪽에서
손쓸 방법이 없다.

## 제안

레코드 하나의 실패를 그 자리에서 던지지 않고 기록만 한 뒤, 배치의 나머지를 계속 처리한다.
성공한 레코드는 실패 여부와 무관하게 항상 커밋한다.

```ts
async publishPending(limit = 50): Promise<number> {
  const pending = await this.store.fetchPending(limit);
  const publishedIds: Array<string | number> = [];

  for (const record of pending) {
    try {
      await withProducerSpan(record.topic, record.key, async (traceHeaders) => {
        await this.producer.send({ topic: record.topic, messages: [/* ... */] });
      });
      producedTotal.inc({ topic: record.topic });
      publishedIds.push(record.id);
    } catch (err) {
      produceErrorsTotal.inc({ topic: record.topic });
      console.error(
        `[OutboxPublisher] 발행 실패, 다음 폴링에서 재시도: id=${record.id} topic=${record.topic}`,
        err instanceof Error ? err.message : String(err),
      );
      // 던지지 않고 다음 레코드로 계속 진행한다 — 이 레코드의 실패가 앞서 성공한 레코드의
      // markPublished를 막거나, 뒤에 남은 레코드의 시도를 막으면 안 된다.
    }
  }

  if (publishedIds.length > 0) {
    await this.store.markPublished(publishedIds);
  }

  return publishedIds.length;
}
```

반환 타입(`Promise<number>`)은 그대로 유지한다 — 실패는 이미 있는
`kafka_forge_produce_errors_total` 지표와 로그로 계속 노출되므로, 불필요한 breaking
change를 만들지 않는다.

## 검증 포인트

- 3개 레코드(정상1 → 독성 → 정상2) 배치에서 `publishPending()` 호출 시, 정상1은
  `markPublished`가 호출되고(재시도에서 제외됨), 독성은 계속 실패로 남고, 정상2도 정상적으로
  시도되어 발행되는지
- 반환값이 실제로 성공한 레코드 수(이 경우 2)와 일치하는지
- 배치 전체가 실패해도(전부 독성) 예외가 호출자에게 전파되지 않고 조용히 0을 반환하는지
  (또는 로그만 남기는지) — 호출자(`OutboxPublisherService`의 `@Interval` 핸들러)가 매번
  터지는 예외로 스케줄러 로그를 오염시키지 않게

## 기각한 대안

- **`OutboxPublisherService`(소비 서비스) 쪽에서 재시도/부분 실패를 직접 처리**: `fetchPending`이
  반환한 레코드를 소비 서비스가 하나씩 순회하며 개별 `producer.send()`를 직접 호출하는 방식도
  가능하지만, 그러면 `OutboxPublisher`가 제공하는 추상화(스팬, 지표 계측)를 다시 구현해야 해서
  라이브러리를 쓰는 의미가 없어진다. 라이브러리 내부에서 바로잡는 게 맞다.
