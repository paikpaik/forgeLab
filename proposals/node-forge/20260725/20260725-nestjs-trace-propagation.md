# node-forge 제안 — NestJS용 trace 전파 + access log 통합 (`core`, `logger/nestjs`, `grpc/nestjs`)

## 계기

`services/msa-checkout`의 API 게이트웨이를 실제 게이트웨이의 5대 책임(라우팅, 인증/인가,
변환, 정책, 관측) 기준으로 감사한 결과, **관측(trace ID 전파 + access log)이 완전히 비어
있었다**. 직접 구현하면서 node-forge를 다시 훑어보다가, `core`에 이미 W3C 표준
`parseTraceparent`/`buildTraceparent`와 `RequestContext` 타입이 있고, **`logger/fastify`의
로거 플러그인은 이미 이걸 활용해 요청마다 자동으로 trace-aware 로거를 붙여주고 있다**는 걸
확인했다.

```ts
// src/logger/fastify/logger.plugin.ts — 이미 있는 기능
fastify.addHook("onRequest", (request, _reply, done) => {
  const rawTraceparent = request.headers["traceparent"] as string | undefined;
  const traceId =
    (rawTraceparent ? parseTraceparent(rawTraceparent)?.traceId : undefined) ??
    (request.headers["x-trace-id"] as string | undefined) ??
    crypto.randomUUID();
  request.forgeLogger = logger.withContext({ traceId, requestId, ip: request.ip });
  done();
});
```

**그런데 `logger/nestjs`, `grpc/nestjs`에는 동등한 기능이 없다.** 이 랩의 실험 4개
(waiting-room, live-ranking, order-outbox, msa-checkout) 전부 NestJS라, fastify에만 있는
이 기능은 지금까지 아무도 못 쓰고 있었던 셈이다. msa-checkout에서 이걸 로컬로 만들어
`docker compose logs`로 gateway→orchestrator gRPC 호출까지 traceId가 정확히 이어지는 걸
실제로 검증했고, 그 설계를 근거로 제안한다.

## 현재 한계

- `logger/nestjs`는 `ForgeLoggerService`만 제공 — 요청 단위로 traceId를 자동으로 붙여주는
  미들웨어가 없어서, 매 서비스가 `res.on("finish")`로 access log를 남기는 코드를 직접 짜야 함
- `grpc/nestjs`는 gRPC 클라이언트/서버 **옵션 빌더**만 제공(1.0.5) — 실제 호출에 trace
  context를 metadata로 실어 보내거나, 서버가 받은 metadata에서 복원하는 기능이 없음
- AsyncLocalStorage로 요청 컨텍스트를 전파하는 프리미티브 자체가 `core`에 없어서, "지금 이
  요청의 traceId가 뭐지"를 어디서든(컨트롤러, 서비스, gRPC 클라이언트) 꺼내 쓸 방법이 없음

## 제안

`core`에 프레임워크 무관 AsyncLocalStorage 래퍼를 추가하고, `logger/nestjs`와 `grpc/nestjs`가
그걸 각각 HTTP/gRPC 진입점에서 채워 넣는 미들웨어/인터셉터를 제공한다.

```ts
// @paikpaik/node-forge/core (신규 — traceparent.ts 옆에 request-context.ts 정도)
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T;
export function getRequestContext(): RequestContext | undefined;
```

```ts
// @paikpaik/node-forge/logger/nestjs (신규)
// fastify 플러그인과 동일한 전략: 들어온 traceparent 재사용, 없으면 생성, ForgeLogger.
// withContext()로 요청별 child logger를 만들어 access log에 사용, AsyncLocalStorage에도 저장
export class TraceAccessLogMiddleware implements NestMiddleware { ... }
```

```ts
// @paikpaik/node-forge/grpc/nestjs (기존 모듈 확장)
export function buildOutgoingTraceMetadata(): Metadata; // 현재 컨텍스트로 traceparent 생성
export class GrpcTraceAccessLogInterceptor implements NestInterceptor { ... } // 서버 진입점
```

msa-checkout이 실제로 검증한 구현(`src/shared/trace/*`, `src/gateway/middleware/
trace-access-log.middleware.ts`)과 동일한 모양이다.

## 검증 포인트

msa-checkout에서 이미 실제로 확인한 시나리오를 그대로 재현할 수 있어야 한다:

- `POST /checkout`처럼 REST→gRPC로 이어지는 요청에서, gateway의 access log와 하위 gRPC
  서버의 access log가 **정확히 같은 traceId**를 갖는지(실제 재현: gateway와 orchestrator의
  `StartCheckout` access log가 동일 traceId `19555ff4...`로 확인됨)
- 들어온 요청에 `traceparent` 헤더가 없으면 새로 생성해서 응답 헤더에도 세팅하는지
- **컨텍스트가 없는 상태**(예: `@Interval` 같은 HTTP 요청과 무관한 백그라운드 트리거)에서
  하위 gRPC를 호출하면, 억지로 이어붙이지 않고 받는 쪽이 자연스럽게 새 trace를 시작하는지
  (실제 재현: msa-checkout의 saga 폴러가 이 경우였고, 정확히 새 traceId로 시작됨 — 이게
  오동작이 아니라 W3C 스펙에 맞는 정상 동작이라는 것도 확인)
- access log에 `method`/`path`(HTTP) 또는 `grpcMethod`(gRPC), `status`, `durationMs`,
  `traceId`, `requestId`가 항상 채워지는지

## 기각한 대안

- **소비 서비스가 매번 직접 구현**: 지금 msa-checkout이 하고 있는 방식 그대로. fastify
  사용자는 이미 갖고 있는 기능을 NestJS 사용자만 매번 새로 짜야 하는 건 애초에 이 랩의
  실험 4개가 전부 NestJS라는 걸 감안하면 낭비가 크다
- **trace ID를 saga/workflow 같은 장기 실행 프로세스의 상관관계 ID로도 겸용하게 만드는 기능**:
  검토했으나 기각. W3C trace-id는 "하나의 유한한 인과적 호출 체인"을 나타내도록 설계된
  것이라, 여러 tick에 걸쳐 진행되는 saga 같은 장기 프로세스에 재사용하면 표준 트레이싱 툴의
  가정과 충돌한다. 장기 프로세스 추적은 `ForgeLogger.withContext()`로 이미 가능한 별도의
  correlation-id 패턴(예: `{sagaId}`를 로그 필드로 추가)을 쓰는 게 맞고, 이건 소비 서비스가
  자기 도메인 ID로 직접 하면 되는 부분이라 forge가 강제할 이유가 없다
- **OpenTelemetry SDK 전체 도입**: 이 랩의 규모(단일 프로세스 로그를 grep해서 확인하는 수준)엔
  과하다. W3C traceparent 포맷만 지켜두면 나중에 실제 OTel Collector를 붙이고 싶을 때도
  헤더/metadata 레벨에서는 바로 호환된다 — 지금 당장 Jaeger/Tempo 같은 백엔드까지 붙일
  필요는 없음
