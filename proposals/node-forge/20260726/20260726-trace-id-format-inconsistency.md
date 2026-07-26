# node-forge 버그 — 새로 발급하는 traceId가 하이픈 포함 UUID라 전파된 값과 문자열이 안 맞음

## 계기

`services/msa-checkout`을 node-forge 1.0.7(`nestjs trace 모듈 추가`)로 올리고 실제
컨테이너에서 재검증하던 중, gateway와 orchestrator의 access log가 **같은 요청**인데도
`traceId` 필드 값이 다른 문자열로 찍히는 걸 발견했다.

```
# gateway (trace를 새로 여는 지점)
{"traceId":"a3ee3f87-ee14-4dff-a759-85c3476d8d2b", ..., "path":"/checkout", "msg":"access"}

# orchestrator (gateway로부터 전파받은 지점)
{"traceId":"a3ee3f87ee144dffa75985c3476d8d2b", ..., "grpcMethod":"/checkout.CheckoutSagaService/StartCheckout", "msg":"access"}
```

두 값을 직접 비교해보면 하이픈만 빼면 완전히 동일한 값이다(`a3ee3f87ee144dffa75985c3476d8d2b`).
즉 **trace 자체는 정확히 전파되고 있지만, 문자열 표현이 달라서 "traceId 필드로 정확 일치
검색(grep, 로그 시스템의 exact-match 쿼리)"을 하면 gateway 쪽 로그를 못 찾는다** — trace
전파 기능의 핵심 사용 목적("traceId 하나로 전체 경로 추적")이 절반만 성립하는 상태다.

## 원인

`logger/nestjs/trace-access-log.middleware.ts`, `grpc/nestjs/grpc-trace.interceptor.ts`,
그리고 이번에 손 안 댄 `logger/fastify/logger.plugin.ts`(더 이전부터 있던 코드) 셋 다 같은
패턴이다 — **들어온 `traceparent`가 없어서 새로 trace를 시작할 때 `crypto.randomUUID()`를
하이픈 그대로 사용**한다.

```ts
// logger/nestjs/trace-access-log.middleware.ts
const traceId =
  (rawTraceparent ? parseTraceparent(rawTraceparent)?.traceId : undefined) ??
  firstHeaderValue(req.headers["x-trace-id"]) ??
  crypto.randomUUID();  // ← 하이픈 포함(예: a3ee3f87-ee14-4dff-...)

// grpc/nestjs/grpc-trace.interceptor.ts
const traceId = parsed?.traceId ?? crypto.randomUUID();  // ← 여기도 동일

// logger/fastify/logger.plugin.ts (1.0.7 이전부터 있던 코드, 이번에 새로 생긴 문제 아님)
const traceId = ... ?? crypto.randomUUID();  // ← 여기도 동일
```

반면 `core/traceparent.ts`의 `buildTraceparent()`는 헤더/metadata로 내보낼 때 하이픈을
제거해서 32-hex로 정규화한다(`traceId.replace(/-/g, "")`). 그래서 **trace를 새로 시작한
프로세스 자신의 로그에는 원본 UUID(하이픈 포함)가 찍히고, 그 trace를 전파받은 하위
프로세스들의 로그에는 정규화된 32-hex가 찍히는** 불일치가 생긴다.

## 재현

msa-checkout에서 `POST /checkout` → gateway가 새 trace 시작 → orchestrator로 gRPC 전파 →
두 access log를 나란히 비교. 값은 동일(하이픈 제거 후 일치), 문자열 표현만 다름을 실제
컨테이너 로그로 확인.

## 제안

세 지점 전부 `crypto.randomUUID()` 대신 정규화된 hex를 발급하도록 수정한다 — 사실상
`buildTraceparent`가 어차피 하는 정규화를, 발급 시점에 미리 해두는 것과 같다.

```ts
// 셋 다 이렇게
const traceId = parsed?.traceId ?? crypto.randomUUID().replace(/-/g, "");
```

또는 `core`에 `generateTraceId()`(정규화된 32-hex를 발급하는) 헬퍼를 하나 추가해서 세
지점이 전부 그걸 쓰게 하면, 앞으로 trace를 새로 여는 지점이 늘어나도(예: kafka-forge 쪽에
비슷한 통합이 생긴다면) 같은 실수가 반복되지 않는다.

```ts
// core/traceparent.ts에 추가
export function generateTraceId(): string {
  return randomBytes(16).toString("hex"); // 32-char hex, 하이픈 없음, buildTraceparent와 동일 규칙
}
```

## 검증 포인트

- 헤더/metadata 없이 처음 요청이 들어왔을 때, access log에 찍히는 `traceId`와 응답
  헤더(`traceparent`)/하위로 전파되는 metadata의 traceId 부분이 **문자열로 정확히 일치**하는지
- 하위 서비스가 전파받은 `traceId`도 최초 발급값과 문자열이 동일한지(현재도 이 방향은
  정상 — `parseTraceparent`가 이미 소문자 32-hex로 반환하므로 전파 체인 안에서는 안 깨짐,
  문제는 오직 "최초 발급 시점"에서만 발생)
- `logger/fastify`, `logger/nestjs`, `grpc/nestjs` 세 곳 모두 같은 형식으로 발급하는지

## 기각한 대안

- **`buildTraceparent`가 아니라 로그 출력 시점에 정규화**: 매번 로그를 남길 때마다
  `traceId.replace(/-/g, "")`를 호출해야 해서, 발급 시점에 한 번 정규화하는 것보다 실수하기
  쉽다(새로운 로그 호출 지점이 추가될 때마다 또 빠뜨릴 수 있음). 소스(발급 시점)에서 한 번에
  고치는 게 근본적
- **하이픈 포함 UUID를 표준으로 삼고 `buildTraceparent`가 반대로 하이픈을 유지하게 바꾸기**:
  W3C Trace Context 스펙 자체가 `trace-id`를 하이픈 없는 32-hex로 정의하므로, 여기서 벗어나면
  나중에 실제 OTel Collector/Jaeger 같은 표준 도구와 붙일 때 다시 변환이 필요해진다. 표준
  포맷 쪽에 맞추는 게 맞다
