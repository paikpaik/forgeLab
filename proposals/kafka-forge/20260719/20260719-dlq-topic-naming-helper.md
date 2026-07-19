# kafka-forge 제안 — DLQ 토픽을 위한 `defineDlqEvent()` 헬퍼 (또는 네이밍 컨벤션 예외)

## 계기

`services/live-ranking`에서 DLQ에 쌓인 이벤트 내용을 사람이 볼 수 있게 별도 컨슈머로
`ranking.score-events.v1.dlq`를 구독하려다가, `defineEvent()`로는 이 토픽에 대한
`EventContract`를 만들 수 없다는 걸 발견했다.

## 현재 한계

토픽 네이밍 컨벤션(`assertValidTopicName`)은 `<domain>.<event>.v<N>` 딱 두 세그먼트만
허용한다.

```ts
const TOPIC_NAME_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.v[0-9]+$/;
```

그런데 `toDlqTopicName()`이 만드는 `<topic>.dlq`는 세그먼트가 3개(`ranking`,
`score-events.v1`, `dlq`)라 이 패턴에 안 맞는다. `defineEvent()`가 내부적으로
`assertValidTopicName`을 호출하기 때문에, DLQ 토픽에 대한 `EventContract`를
`defineEvent()`로 만들면 그 자리에서 던진다 — **kafka-forge가 스스로 만드는 파생 토픽이
자기 네이밍 컨벤션을 어기는 상황**이다.

## 우회

`EventContract`가 순수 인터페이스라, `defineEvent()`를 거치지 않고 리터럴로 직접 만들어서
검증을 우회했다.

```ts
// 우회 — defineEvent() 안 쓰고 인터페이스를 직접 만족시킴
const DlqEnvelopeSchema = z.object({
  payload: ScoreEventSchema,
  error: z.string(),
  failedAt: z.string(),
});

export const ScoreEventDlq: EventContract<typeof DlqEnvelopeSchema> = {
  topic: toDlqTopicName(ScoreEvent.topic),
  schema: DlqEnvelopeSchema,
  partitionKey: (envelope) => envelope.payload.leaderboardId,
};
```

동작은 하지만, 두 가지 보일러플레이트를 매번 직접 써야 한다: (1) DLQ 메시지가
`{ payload, error, failedAt }` 형태라는 걸 알고 있어야 하고, (2) 원본 스키마를 감싸는
envelope 스키마를 매번 새로 정의해야 한다.

## 제안

원본 `EventContract`로부터 DLQ용 `EventContract`를 만들어주는 헬퍼를 제공한다.

```ts
// event-contract.ts (또는 topic-name.ts)
import { z } from "zod";

export function defineDlqEvent<T extends ZodType>(
  original: EventContract<T>,
): EventContract<ZodType<{ payload: z.infer<T>; error: string; failedAt: string }>> {
  const schema = z.object({
    payload: original.schema,
    error: z.string(),
    failedAt: z.string(),
  });
  return {
    topic: toDlqTopicName(original.topic), // assertValidTopicName을 거치지 않음 — DLQ 토픽은
                                            // 이 컨벤션의 대상이 아니라고 명시적으로 취급
    schema,
    partitionKey: (envelope) => original.partitionKey(envelope.payload),
  };
}
```

사용하는 쪽은 이렇게 줄어든다.

```ts
export const ScoreEventDlq = defineDlqEvent(ScoreEvent);
```

## 검증 포인트

- `defineDlqEvent(ScoreEvent).topic`이 `toDlqTopicName(ScoreEvent.topic)`과 정확히 일치하는지
- 반환된 스키마가 `{ payload: <원본 스키마 검증>, error: string, failedAt: string }`을
  올바르게 검증/거부하는지
- `partitionKey`가 원본 이벤트의 `partitionKey`에 `envelope.payload`를 넘겨 위임하는지
- `defineDlqEvent()`로 만든 토픽명은 `assertValidTopicName` 검증을 받지 않아도(우리가
  이미 `toDlqTopicName()`을 거쳤으니 안전한 값이라는 전제) 문제없이 `StandardConsumer.subscribe()`가
  받아들이는지

## 기각한 대안

- **`assertValidTopicName`의 정규식만 `.dlq` 접미사를 허용하도록 완화**: 검증 문제는
  풀리지만, 사용자가 여전히 매번 envelope 스키마(`{payload, error, failedAt}`)를 직접
  정의해야 하는 보일러플레이트는 그대로 남는다. 헬퍼 제공이 검증 우회와 보일러플레이트
  제거를 한 번에 해결한다.
