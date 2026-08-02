# node-forge 제안 — Redis 기반 분산 circuit breaker (다중 인스턴스 회로 상태 공유)

## 계기

5번째 실험 `webhook-relay`(웹훅 전달 플랫폼)에서, 배달 실패가 반복되는 엔드포인트로
계속 HTTP 요청을 보내지 않도록 circuit breaker가 필요했다. node-forge의
`ForgeCircuitBreaker`(`core/circuit-breaker.ts`)를 쓰려고 소스를 먼저 읽어봤는데,
`state`/`failures`/`openedAt`을 인스턴스 필드로만 갖는 순수 인메모리 클래스라는 걸 확인했다.

이 실험은 `delivery-worker`를 여러 인스턴스로 스케일하는 게 핵심 시나리오라(같은
엔드포인트로 가는 배달이 파티션에 따라 서로 다른 인스턴스에 배정될 수 있음), 회로
상태를 인스턴스마다 따로 가지면 회로 차단기가 있으나 마나 해진다 — 인스턴스 A가 어떤
엔드포인트의 연속 실패를 보고 OPEN으로 전환해도, 인스턴스 B는 그걸 전혀 모른 채 계속
같은 엔드포인트를 두드리게 된다.

그래서 `RedisCircuitBreaker`를 로컬로 구현하고(`shared/redis-circuit-breaker.ts`), 실제로
delivery-worker를 2개 인스턴스로 스케일해서 검증했다:

- Kafka 토픽 파티션을 4개로 늘려 두 인스턴스가 실제로 서로 다른 파티션을 소비하는 것 확인
  (`memberAssignment: {webhook.deliveries.v1: [0,2]}` / `[1,3]`)
- fail 시나리오 엔드포인트로 이벤트 6건을 동시 발행 → 공유 카운터가 원자적으로 임계치(3)를
  넘겨 OPEN 전환, 그 이후 요청은 실제 HTTP 호출 없이 즉시 보류되는 것 확인
- 6건 중 5건은 동시 발행 레이스로 이미 실제 HTTP 시도가 나간 뒤였지만(분산 시스템에서
  "이미 인플라이트인 동시 요청"까지 즉시 취소하지는 못하는 정상적인 한계), 마지막 1건은
  확실히 막혔다 — **로컬(인스턴스별) 회로였다면 각 인스턴스가 독립적으로 3번씩 채워야 해서
  최소 6건 다 실제로 나갔을 것**이라는 점과 대비된다
- 엔드포인트를 정상으로 고치고 데드레터를 복구(replay)하자 회로가 자동으로 CLOSED로
  복귀하는 것까지 확인

로컬 유닛 테스트(상태 전이 5건)와 실제 멀티 인스턴스 Docker 검증 둘 다 통과한 뒤에
이 제안서를 쓴다(local-first-then-propose 컨벤션).

## 현재 forge로 안 되는 이유

`ForgeCircuitBreaker`는 의도적으로 단순한 단일 프로세스용 클래스다(인스턴스 필드에 상태
저장, `execute(fn)`으로 감싸서 씀). 이건 "이 프로세스 안에서 하나의 다운스트림 의존성을
보호"하는 흔한 케이스엔 충분하지만, 다음 두 조건이 겹치면 못 쓴다:

1. 보호 대상 프로세스가 여러 인스턴스로 스케일된다
2. 회로가 "하나"가 아니라 "동적으로 늘어나는 여러 개"다(이 실험처럼 엔드포인트마다 하나씩 —
   엔드포인트 수가 배포 시점에 정해지지 않고 런타임에 계속 늘어남)

## 제안하는 API 형태

기존 `ForgeCircuitBreaker`는 그대로 둔다(단일 프로세스/단일 회로 케이스에 여전히 맞고,
바꾸면 하위 호환이 깨짐). `redis` 모듈에 새 클래스를 추가한다 — `ForgeRedisClient`에
의존하므로 `core`가 아니라 `redis`에 두는 게 기존 의존 방향과 맞다.

```ts
// redis/circuit-breaker.ts (신규)
import type { ForgeRedisClient } from "./redis";
import type { CircuitState } from "../core/circuit-breaker"; // CLOSED | OPEN | HALF_OPEN, 기존 타입 재사용
import { ForgeError } from "../core/errors";

export interface DistributedCircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  keyPrefix?: string; // 기본값 "circuit"
}

// ForgeCircuitBreaker는 "인스턴스 하나 = 회로 하나"지만, 이 클래스는 "인스턴스 하나 = 여러
// 키(회로)"를 관리한다 — webhook-relay처럼 보호 대상이 런타임에 동적으로 늘어나는(엔드포인트,
// 다운스트림 서비스 등) 경우를 위한 것. 매번 새 ForgeCircuitBreaker를 만들면 그 자체가
// 인메모리라 여전히 인스턴스 로컬이 되므로 별도 클래스가 필요하다.
export class DistributedCircuitBreaker {
  constructor(
    private readonly redis: ForgeRedisClient,
    private readonly options: DistributedCircuitBreakerOptions,
  ) {}

  async getState(key: string): Promise<CircuitState> { /* hgetall + resetTimeout 경과 시 HALF_OPEN */ }
  async recordSuccess(key: string): Promise<void> { /* hmset으로 CLOSED 리셋 */ }
  async recordFailure(key: string): Promise<{ state: CircuitState }> { /* hincrby로 원자 증가 */ }

  // ForgeCircuitBreaker.execute와 대칭되는 편의 메서드 — OPEN이면 fn을 호출하지 않고
  // 즉시 ForgeError('E9502')를 던진다(기존과 동일 에러 코드로 일관성 유지).
  async execute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if ((await this.getState(key)) === "OPEN") {
      throw new ForgeError("E9502", `Circuit is open: ${this.options.keyPrefix ?? "circuit"}:${key}`);
    }
    try {
      const result = await fn();
      await this.recordSuccess(key);
      return result;
    } catch (err) {
      await this.recordFailure(key);
      throw err;
    }
  }
}
```

webhook-relay의 `RedisCircuitBreaker`는 이 제안이 반영되면 `DistributedCircuitBreaker`로
교체하고 로컬 구현은 삭제할 예정이다.

## 검증 포인트

- 여러 인스턴스에서 같은 key로 `recordFailure`를 동시에 호출해도 `failureThreshold`를
  정확히 넘긴 시점에만 OPEN 전환되는지(카운터 레이스 없음) — `hincrby` 원자성으로 이미
  webhook-relay에서 확인
- `resetTimeout` 경과 후 `getState`가 HALF_OPEN을 반환하는지, 그 뒤 성공/실패에 따라
  CLOSED/OPEN으로 정확히 전이하는지
- `execute()`가 `ForgeCircuitBreaker.execute()`와 동일한 호출 계약(성공 시 결과 반환, 실패 시
  원본 에러 재던짐, OPEN이면 E9502)을 지키는지

## 기각한 대안

- **`ForgeCircuitBreaker`에 pluggable state backend(옵션으로 저장소 주입) 추가**: 기존
  "인스턴스 하나 = 회로 하나" API를 유지하면서 "여러 키" 축을 넣으려면 API가 복잡해진다
  (모든 메서드에 key 파라미터를 추가해야 하는데, 그러면 사실상 지금 제안하는 새 클래스와
  같아짐). 기존 클래스는 단순하게 두고 새 클래스로 분리하는 게 더 명확하다고 판단
- **HALF_OPEN에서 "탐색 요청 딱 하나만 통과"시키는 정교한 조율(분산 락 등)**: 교과서적인
  circuit breaker는 이렇게 하지만, webhook-relay 실험에서는 resetTimeout이 지나면 모든
  인스턴스가 동시에 탐색을 시도하도록 단순화했고 실측에서 이 정도로도 충분히 유효했다 —
  실패하면 다시 OPEN, 성공하면 CLOSED. 과설계 방지 차원에서 이번 제안에는 포함하지 않고,
  필요성이 실제로 확인되면 별도 후속 제안으로 검토
- **get+set으로 실패 카운터 증가**: 여러 인스턴스가 동시에 읽고 쓰면 레이스로 카운트가
  덜 늘어날 수 있어서 기각 — `hincrby`(Redis 원자 연산) 하나로 끝냄
