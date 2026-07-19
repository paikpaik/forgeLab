# kafka-forge 제안 — `consumedTotal` 지표 이름/의미 명확화 (성공 전용 카운터 분리)

## 계기

live-ranking에서 파이프라인이 새는 데 없이 잘 처리됐는지 데이터로 검증하면서
`kafka_forge_consumed_total`, `kafka_forge_consume_errors_total`,
`live_ranking_score_events_applied_total`(자체 지표) 세 값을 놓고 정합성을 맞춰봤는데,
`consumed_total = applied + consume_errors`(예: 70 = 65 + 5)라는 걸 소스 코드까지 가서
확인해야 이해할 수 있었다.

## 현재 한계

`consumer.ts`를 보면 `consumedTotal.inc()`는 핸들러가 **성공했는지 실패해서 DLQ로
갔는지와 무관하게** 항상 증가한다.

```ts
await withConsumerSpan(/* ... */, async () => {
  try {
    await this.runWithRetry(event, parsed.data, handler, retry); // 내부에서 실패 시 catch하고 DLQ로 보낸 뒤 정상 반환
    consumedTotal.inc({ topic: event.topic, group: this.groupId }); // 성공/실패 무관하게 여기까지 도달
  } finally {
    stopTimer();
  }
});
```

지표 이름이 `consumed_total`이라 "정상적으로 소비(처리)된 메시지 수"로 읽히기 쉬운데,
실제로는 "이 컨슈머가 시도한 메시지 수(성공 + DLQ 이동 포함)"에 더 가깝다. Prometheus
대시보드를 보는 사람이 이름만 보고 `consumed_total`을 "성공 처리량"으로 오독하면,
실패율(`consume_errors_total / consumed_total`)을 계산할 때는 맞지만 "얼마나 성공적으로
처리됐는가"를 물을 때는 착각하기 쉽다.

## 우회

없음 — 소스 코드를 직접 읽고 `consumed_total`과 `consume_errors_total`을 조합해서
"진짜 성공 건수 = consumed_total - consume_errors_total"임을 추론해서 썼다. 이 관계를
문서 어디에도 명시하지 않아서, kafka-forge를 처음 쓰는 사람은 매번 이걸 다시 추론해야 한다.

## 제안

두 가지 중 하나(또는 둘 다).

**(a) 지표 이름을 의미에 맞게 바꾸거나 문서화**: `consumed_total`의 JSDoc/`help` 문구에
"성공/실패(DLQ 이동) 모두 포함, 순수 성공 건수는 `consumed_total - consume_errors_total`"을
명시한다. 이름을 바꾸는 게 breaking change라 부담되면 최소한 `help` 텍스트만이라도
명확하게 고친다.

```ts
export const consumedTotal = new Counter({
  name: "kafka_forge_consumed_total",
  help: "처리를 시도한 메시지 수(성공 + 재시도 소진 후 DLQ 이동 포함). 순수 성공 건수는 " +
        "consumed_total - consume_errors_total 로 계산한다.",
  // ...
});
```

**(b) 순수 성공 카운터를 별도로 추가**: `handledTotal`(성공한 것만) 같은 지표를 새로
추가해서, 대시보드에서 굳이 두 지표를 빼는 계산 없이 바로 쓸 수 있게 한다.

```ts
export const handledTotal = new Counter({
  name: "kafka_forge_handled_total",
  help: "핸들러가 최종적으로 성공한 메시지 수 (재시도 성공 포함, DLQ 이동은 제외)",
  labelNames: ["topic", "group"],
  registers: [metricsRegistry],
});

// processMessage()
const succeeded = await this.runWithRetry(/* ... */);
consumedTotal.inc(/* ... */); // 기존 유지 (하위 호환)
if (succeeded) handledTotal.inc({ topic: event.topic, group: this.groupId });
```

(a)는 당장 코드 변경 없이 바로 할 수 있고, (b)는 `20260719-idempotency-release-on-dlq.md`
제안에서 이미 `runWithRetry`가 성공 여부(`boolean`)를 반환하도록 바꾸자고 했으니, 그
변경에 자연스럽게 얹을 수 있다.

## 검증 포인트

- (b)를 적용한다면: 성공한 메시지는 `handledTotal`과 `consumedTotal`이 함께 증가하고,
  DLQ로 간 메시지는 `consumedTotal`과 `consumeErrorsTotal`만 증가(`handledTotal`은 그대로)하는지

## 기각한 대안

- **`consumed_total`을 "성공만" 세도록 동작 자체를 바꾸는 것**: 기존에 이 지표를
  "시도 총량"으로 쓰고 있던 소비 서비스가 있다면 그 의미가 조용히 바뀌어버리는 breaking
  change라, 이름/문서 정리나 새 지표 추가 쪽이 더 안전하다.
