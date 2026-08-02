# node-forge 제안 추가 — DistributedCircuitBreakerOptions에 successThreshold/onStateChange 보강

## 계기

같은 날 먼저 넘긴 `20260801-distributed-circuit-breaker.md` 제안서의
`DistributedCircuitBreakerOptions`를 다시 보니, 기존 `CircuitBreakerOptions`
(`core/circuit-breaker.ts`)에 있는 `successThreshold`/`name`/`onStateChange`를
빠뜨렸다는 걸 뒤늦게 확인했다. webhook-relay의 로컬 구현(`RedisCircuitBreaker`)이
애초에 그 셋을 안 쓰고 있었던 걸(성공 즉시 무조건 CLOSED로 리셋, 상태 전환을 아무도
구독 못 함) 제안서에 그대로 옮겨서 생긴 누락이다. 이미 넘긴 제안서를 고치는 대신,
이 문서에 정리해서 추가로 전달한다.

## 현재 제안(20260801-distributed-circuit-breaker.md)에서 빠진 것

| 기존 `CircuitBreakerOptions` | 처음 제안에 포함? | 비고 |
|---|---|---|
| `failureThreshold` | O | |
| `resetTimeout` | O | |
| `successThreshold` | **X** | HALF_OPEN에서 몇 번 연속 성공해야 CLOSED로 돌아갈지 — 로컬 구현은 이걸 무시하고 항상 1번 성공하면 바로 CLOSED로 리셋했음 |
| `name` | **X** | 이 클래스는 "인스턴스 하나 = 여러 키"라 `key` 자체가 이미 식별자 역할을 해서 그대로는 불필요 — 대신 `keyPrefix`(Redis 키 네임스페이스)로 대체 제안 |
| `onStateChange` | **X** | 상태 전환 콜백(로깅/메트릭 연결용) — 로컬 구현엔 아예 없어서 관측 공백이 있었음 |

## 보강한 API

```ts
export interface DistributedCircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  /** HALF_OPEN → CLOSED 전환에 필요한 연속 성공 횟수. 기본값 1(ForgeCircuitBreaker와 동일) */
  successThreshold?: number;
  /** Redis 키 네임스페이스. 기본값 "circuit" — `name`과 달리 회로 하나의 식별자가 아니라
   * (그건 매 호출의 key가 담당), 같은 Redis를 공유하는 여러 앱의 키 충돌을 막는 접두사 */
  keyPrefix?: string;
  /** 상태 전환 콜백 — 기존과 같은 목적(로깅/메트릭)이지만, "이 key에 대해" 바뀐 것이므로
   * key도 함께 받는다. */
  onStateChange?: (key: string, from: CircuitState, to: CircuitState) => void;
}
```

`recordSuccess(key)`는 이제 현재 state를 먼저 읽어서: CLOSED면 카운터만 정리하고 아무 일도
안 하고, HALF_OPEN(계산값)이면 `successes`를 `hincrby`로 원자 증가시켜 `successThreshold`
이상일 때만 실제로 CLOSED 전환 + `onStateChange(key, "OPEN", "CLOSED")`를 호출한다.
`recordFailure(key)`는 `failureThreshold` 도달 또는 이미 OPEN(HALF_OPEN 탐색 실패, 기존
`ForgeCircuitBreaker`와 동일하게 즉시 재개방) 시 `onStateChange(key, 이전상태, "OPEN")`을
호출한다.

**주의(설계상 한계, 문서화 필요)**: HALF_OPEN은 Redis에 실제로 쓰이는 상태가 아니라
`getState()`가 "OPEN인데 resetTimeout이 지났다"를 읽는 시점에 계산해서 보여주는 값이다.
그래서 `onStateChange`는 CLOSED↔OPEN 전환(실제 Redis 쓰기가 일어나는 순간)에만 호출되고,
"누군가 HALF_OPEN을 읽었다"는 이벤트로는 호출되지 않는다 — 상태를 실제로 HALF_OPEN으로
전이·저장하는 `ForgeCircuitBreaker`와의 차이점이라 명시해둔다.

## 검증 포인트 (기존 제안서의 검증 포인트에 추가)

- `successThreshold`를 2 이상으로 설정했을 때, HALF_OPEN에서 성공이 그 미만이면 CLOSED로
  전환되지 않고 성공 카운터만 누적되는지
- `onStateChange`가 실제 상태 쓰기(CLOSED→OPEN, OPEN→CLOSED)가 일어난 순간에만, 정확한
  `key`/`from`/`to`로 호출되는지 — HALF_OPEN을 읽기만 했을 때는 호출되지 않는지

## 기각한 대안

- **`name`을 그대로 유지**: 이 클래스는 다중 키를 관리하므로 "회로 하나의 이름"이라는
  개념 자체가 안 맞는다 — 매 호출의 `key`가 이미 그 역할을 하고, 네임스페이스가 필요하면
  `keyPrefix`로 충분하다고 판단
- **HALF_OPEN도 Redis에 실제로 저장해서 onStateChange가 그 진입도 잡게 하기**: 가능은
  하지만 "읽을 때마다 쓰기가 발생"하는 부작용이 생기고(getState는 원래 읽기 전용이어야
  자연스러움), 여러 인스턴스가 동시에 읽으면서 서로 "내가 먼저 HALF_OPEN으로 전이시켰다"는
  경합까지 생긴다 — 과설계로 판단해 이번 제안에서는 제외(HALF_OPEN 진입 자체보다, "탐색이
  성공/실패했다"는 결과 쪽이 관측 가치가 더 크다고 봄)
