# node-forge 제안 — `checkHealth`/`HealthModule`에 짧은 캐싱 옵션 추가

## 계기

`services/live-ranking`의 `createKafkaHealthChecker`가 `GET /health`를 호출할 때마다
Kafka Admin 연결을 새로 열고 닫는다.

```ts
// shared/kafka-health.ts
export function createKafkaHealthChecker(kafka: Kafka): HealthChecker {
  return async () => {
    const admin = kafka.admin();
    await admin.connect();      // 호출마다 새 연결
    try {
      await admin.listTopics();
    } finally {
      await admin.disconnect(); // 호출마다 닫음
    }
  };
}
```

`/health`를 자주(예: 컨테이너 오케스트레이터가 몇 초 간격으로) 찔러보는 환경이면, 이
연결 생성/해제 비용이 계속 반복된다. Redis `ping()`처럼 가벼운 체커는 문제가 안 되지만,
Kafka Admin처럼 연결 자체가 무거운 체커는 매 호출마다 새로 여는 게 비효율적이다.

## 현재 한계

`HealthChecker`는 `() => Promise<void>`로 매번 그대로 실행되는 함수일 뿐이고,
`checkHealth()`/`HealthModule`에는 결과를 잠깐 캐싱해두는 옵션이 없다.

```ts
export type HealthChecker = () => Promise<void>;

export async function checkHealth(checkers: Record<string, HealthChecker>): Promise<HealthReport> {
  const checks = await Promise.all(
    entries.map(async ([name, checker]) => {
      await checker(); // 매번 그대로 실행
      // ...
    }),
  );
  // ...
}
```

## 제안

`checkHealth()`(또는 `HealthModule.forRootAsync`)에 짧은 캐싱 옵션을 추가해서, 지정한
시간(ms) 안에 들어온 반복 호출은 이전 결과를 재사용하게 한다.

```ts
export interface CheckHealthOptions {
  /** 이 시간(ms) 안의 반복 호출은 새로 실행하지 않고 마지막 결과를 재사용한다. 생략하면 캐싱 없음(기존 동작). */
  cacheMs?: number;
}

export async function checkHealth(
  checkers: Record<string, HealthChecker>,
  options: CheckHealthOptions = {},
): Promise<HealthReport> {
  // options.cacheMs가 있으면 마지막 실행 시각/결과를 모듈 내부에 들고 있다가, 그 시간 안이면
  // 재실행 없이 캐시된 HealthReport를 반환
}
```

`HealthModule.forRootAsync`에도 동일한 옵션을 그대로 전달할 수 있게 한다.

## 검증 포인트

- `cacheMs`를 지정했을 때, 그 시간 안에 `checkHealth()`를 여러 번 불러도 각 `HealthChecker`
  함수가 실제로는 한 번만 실행되는지(호출 카운트로 검증)
- `cacheMs`가 지난 뒤에는 다시 실제로 실행되는지
- `cacheMs`를 생략하면 기존과 동일하게 매번 실행되는지(하위 호환)
- 캐싱 중에도 `checker` 하나가 실패 상태였다면, 캐시가 만료되기 전까지는 그 실패 상태가
  그대로 유지되는지(사용자가 예상 가능한 동작)

## 기각한 대안

- **소비 서비스가 직접 `HealthChecker` 안에서 캐싱을 구현**(지금 우회 없이 그냥 두고
  있는 상태): 매 서비스가 같은 캐싱 로직을 반복 작성해야 하고, `checkHealth`가 매번
  캐시 유무와 무관하게 모든 체커를 병렬 실행하는 구조라 서비스 쪽에서 끼워넣기가
  자연스럽지 않다. `checkHealth`/`HealthModule` 레벨에서 옵션으로 제공하는 게 재사용성이 높다.
