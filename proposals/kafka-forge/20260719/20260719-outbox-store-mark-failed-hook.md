# kafka-forge 제안 — `OutboxStore`에 `markFailed` 훅 추가 (영구 실패 레코드 격리를 위한 최소 통로)

## 계기

`20260719-outbox-publisher-partial-failure.md`로 "하나의 실패가 다른 레코드를 막지 않게"는
고쳐지지만, **영구적으로 실패하는 레코드 자체는 여전히 무한 재시도**된다(재현 시
백오프 없이 5초마다 계속 시도됨). `StandardConsumer`는 소비 실패에 대해 재시도+DLQ로
격리 수단이 있는데, 발행(outbox) 쪽에는 그 대응이 전혀 없어 비대칭이다.

## 현재 한계

`OutboxStore`는 성공만 통보받는다.

```ts
export interface OutboxStore {
  fetchPending(limit: number): Promise<OutboxRecord[]>;
  markPublished(ids: Array<string | number>): Promise<void>;
}
```

`OutboxPublisher`가 발행 실패를 `catch`하지만 그 사실을 store에 전달하는 통로가 없어서,
소비 서비스의 `OutboxStore` 구현체는 "이 레코드가 몇 번 실패했는지"를 원천적으로 알 수
없다. 그래서 "N번 실패하면 더 이상 재시도하지 않기" 같은 걸 구현하려 해도 시작점이 없다.

## 우회

없음 — 실패 시점의 신호를 소비 서비스가 받을 방법이 없어서, `OutboxStore` 밖에서
흉내 낼 방법이 없다(예: `fetchPending()`이 같은 레코드를 다시 반환하는 걸 "실패했었다"는
신호로 추정하는 방식도 있지만, 진짜 시도됐는지/그냥 아직 순서가 안 왔는지 구분이
안 돼서 정확하지 않다).

## 제안

`OutboxStore`에 선택적 훅 `markFailed`만 추가한다. "몇 번 실패하면 포기할지", "포기한
레코드를 어떻게 할지"(삭제/보관/알림)는 store 구현체(소비 서비스) 책임으로 완전히
남긴다 — `IdempotencyStore`의 `claim`/`release`와 같은 설계 원칙(저장소 비의존, 정책은
구현체에)이다.

```ts
export interface OutboxStore {
  fetchPending(limit: number): Promise<OutboxRecord[]>;
  markPublished(ids: Array<string | number>): Promise<void>;
  /**
   * (선택) 발행 실패를 통보한다. 구현하지 않으면(하위 호환) 호출되지 않고 지금처럼 계속
   * 재시도된다. "몇 번 실패하면 포기할지", "포기한 레코드를 어떻게 할지"는 이 메서드
   * 안에서 store가 전적으로 결정한다 — OutboxPublisher는 관여하지 않는다.
   */
  markFailed?(id: string | number, error: unknown): Promise<void>;
}
```

`OutboxPublisher`는 `20260719-outbox-publisher-partial-failure.md`에서 이미 있는 catch
블록에 한 줄만 추가한다.

```ts
} catch (err) {
  produceErrorsTotal.inc({ topic: record.topic });
  await this.store.markFailed?.(record.id, err);
  console.error(/* ... */);
}
```

## 검증 포인트

- `markFailed`를 구현한 fake `OutboxStore`로: 발행이 실패한 레코드의 id와 에러가 정확히
  전달되는지
- `markFailed`를 구현하지 않은(레거시) `OutboxStore`를 넘겨도 `OutboxPublisher`가 그냥
  건너뛰고 기존과 동일하게 동작하는지(하위 호환, `?.` 옵셔널 체이닝이라 에러 없이 스킵)
- `markFailed` 호출 자체가 예외를 던져도 `publishPending()`의 나머지 배치 처리를
  막지 않는지(관측용 훅이 핵심 로직을 막으면 안 됨 — 필요하다면 `markFailed` 호출도
  try/catch로 감싸는 걸 검토)

## 기각한 대안

- **`OutboxPublisher`에 `maxAttempts` 옵션 + `markDead` 메서드까지 kafka-forge가 직접
  제공**: kafka-forge가 "몇 번이면 포기"라는 정책을 대신 정해주는 셈인데, 이건
  `kafka-forge`의 원칙(저장소/정책 비의존 — 인터페이스만 제공하고 실제 구현·정책은
  소비 서비스 책임)과 맞지 않는다. 시도 횟수 추적과 포기 기준은 서비스마다 다를 수밖에
  없는 정책이라, 훅 하나만 주고 나머지는 `TypeormOutboxStore` 같은 구현체가 스스로
  결정하게 하는 쪽이 기존 설계와 일관된다.
