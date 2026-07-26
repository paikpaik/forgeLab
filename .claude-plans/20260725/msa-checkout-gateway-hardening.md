# msa-checkout-gateway-hardening — API 게이트웨이 5대 기능 완성

## 플랜 실행 이력

### 후속: 2026-07-26 — node-forge 1.0.8 채택(traceId 포맷 불일치 완전 해결)

바로 앞 라운드에서 재현·제안한 traceId 문자열 불일치 버그가 1.0.8로 수정됐다는 알림.
`core`에 `generateTraceId()` 헬퍼 추가, `logger/nestjs`/`grpc/nestjs`/`logger/fastify`(1.0.7
이전부터 있던 코드까지) 세 곳 전부 수정 확인 — 제안서 그대로 반영됨.

**실제 변경 파일**: `package.json`(node-forge `^1.0.7` → `^1.0.8`)만 — API 변경이 없어
msa-checkout 코드는 안 건드림.

**검증**: 이전과 동일한 시나리오 재현 — 이번엔 gateway/orchestrator 로그의 traceId가
**문자열까지 완전히 동일**함을 확인(`b5695a1710d1bfef3a12bb0b05cea0ef`),
`grep -c "\"traceId\":\"$TRACE_ID\""`로 정확 일치 검색 2건(양쪽 다) 확인. saga CONFIRMED,
vitest 22개 통과.

**계획과의 차이**: 없음.

**잔존 작업**: 없음. 이걸로 두 제안서(`nestjs-trace-propagation`, `trace-id-format-
inconsistency`) 모두 실제 반영 확인 완료 — 관측(5번 항목) 관련 후속 작업 없음.

---

### 후속: 2026-07-26 — node-forge 1.0.7 채택(trace 전파 공식 API 전환) + 새 버그 발견

2단계에서 로컬 구현 후 쓴 제안서(`20260725-nestjs-trace-propagation.md`)가 1.0.7로
반영됐다는 알림 — 실제 커밋을 읽어 확인 후 채택.

**실제 변경 파일**: `package.json`(node-forge `^1.0.7`), `src/shared/trace/*` 및
`gateway/middleware/trace-access-log.middleware.ts` 삭제, 4개 gRPC 클라이언트 wrapper +
3개 gRPC 컨트롤러 + `gateway/app.module.ts`의 import를 node-forge 공식 경로로 전환.

**검증**: 이전과 동일한 시나리오(gateway→orchestrator hop) 재현 — traceId **값**은 정확히
일치. 다만 **문자열 표현**이 process마다 다른 새 버그를 발견(trace를 새로 여는 지점은
하이픈 포함 UUID, 전파받은 지점은 하이픈 없는 32-hex) — 값은 같아도 grep 정확 일치가 깨짐.
`crypto.randomUUID()`를 정규화 없이 쓰는 게 원인, 제안서 작성
(`proposals/node-forge/20260726/20260726-trace-id-format-inconsistency.md`). vitest 22개,
tsc 클린.

**계획과의 차이**: 없음 — 이 플랜 자체는 이미 완료 상태, node-forge 버전 채택에 따른
후속 조치만 추가.

**잔존 작업**: `trace-id-format-inconsistency` 제안서 반영 확인은 다음 라운드로.

---

### 완료: 2026-07-26 — 4단계(정책: rate limit/CORS/IP 차단) + 전체 마무리

**결과**: 성공. 이걸로 4단계 전부 완료 — API 게이트웨이 5대 책임(라우팅/인증인가/변환/정책/
관측)이 전부 완전 구현으로 확인됨(ARCHITECTURE.md의 최종 감사표 참고).

**실제 변경 파일**:
- `package.json` — `@nestjs/throttler` 추가
- `src/gateway/app.module.ts` — `ThrottlerModule`/`APP_GUARD`, `IpBlockMiddleware` 등록
- `src/gateway/middleware/ip-block.middleware.ts` 신규
- `src/gateway/main.ts` — `app.enableCors()` 추가

**계획과의 차이**: 없음.

**검증**: 짧은 한도(`RATE_LIMIT_LIMIT=3`)로 임시 컨테이너 띄워 4번째 요청부터 429 실제 확인,
`BLOCKED_IPS`로 실제 클라이언트 IP 차단 시 403 확인, CORS 응답 헤더 확인. 정식 gateway(기본
한도)는 정상 동작 유지 확인. vitest 22개, tsc 클린.

**잔존 작업**: 없음. 이 플랜(`msa-checkout-gateway-hardening`) 완료.

---

### 완료: 2026-07-25 — 3단계(변환: gRPC status → HTTP 매핑)

**결과**: 성공

**실제 변경 파일**:
- `src/gateway/filters/grpc-status.filter.ts` 신규 — `GrpcStatusExceptionFilter`
- `src/gateway/main.ts` — `ForgeExceptionFilter` 다음 순서로 등록

**계획과의 차이**: 없음.

**검증**: `docker compose stop orchestrator`로 실제 다운시킨 뒤 `/checkout` 호출 → 이전엔
500으로만 뭉뚱그려지던 게 정확히 503(`E9500`, ECONNREFUSED 메시지 포함)으로 매핑됨을 확인.
재기동 후 정상 201 복구도 확인. vitest 22개, tsc 클린.

**잔존 작업**: 없음 — 4단계(정책)로 진행.

### 완료: 2026-07-25 — 2단계(관측: trace ID + access log)

**결과**: 성공

**실제 변경 파일**:
- `src/shared/trace/{trace-context,grpc-trace,grpc-trace-access-log.interceptor}.ts` 신규
- `src/gateway/middleware/trace-access-log.middleware.ts` 신규, `gateway/app.module.ts`에 등록
- 4개 gRPC 클라이언트 wrapper — 호출마다 `buildOutgoingMetadata()` 첨부
- orchestrator/order-service/inventory-service의 gRPC 컨트롤러 3개에
  `@UseInterceptors(GrpcTraceAccessLogInterceptor)` 추가

**계획과의 차이**: traceparent 파싱/생성 유틸을 새로 만들 계획이었으나, node-forge core에
이미 `parseTraceparent`/`buildTraceparent`가 있는 걸 발견해 그대로 재사용 — 계획보다 적게
구현.

**검증**: `POST /checkout` 후 응답 헤더 traceparent로 gateway/orchestrator 로그를 grep해
`StartCheckout` hop까지는 traceId가 정확히 전파되는 것 확인. 그 이후 `SagaProcessorService`
폴러가 하는 gRPC 호출들은 각각 새 traceId로 시작되는 것도 확인(예상된 설계상 한계,
ARCHITECTURE.md에 기록). access log 필드(grpcMethod/status/durationMs/traceId) 정상. vitest
22개, tsc 클린.

**잔존 작업**: `SagaProcessorService`가 sagaId를 traceId로 재사용하는 안은 사용자와 논의
후 기각 — W3C trace-id 의미론과 충돌해서, 장기 프로세스 추적은 `sagaId`를 별도 로그 필드로
추가하는 correlation-id 패턴이 맞다는 결론(아직 미구현, 필요시 별도로 진행). node-forge
제안서는 `proposals/node-forge/20260725/20260725-nestjs-trace-propagation.md`로 작성 완료.

---

### 완료: 2026-07-25 — 1단계(포트 은닉)

**결과**: 성공

**실제 변경 파일**:
- `docker-compose.yml` — orchestrator/order-service의 `ports:` 섹션 제거

**계획과의 차이**: 없음.

**검증**: `curl --max-time 3 http://localhost:3301/health`, `:3302/health` 둘 다 connection
refused 확인. `docker exec`으로는 내부 접근 정상. gateway 경유 체크아웃 흐름(201) 정상.

**잔존 작업**: 없음 — 2단계(관측)로 진행.

---

## 목표

msa-checkout의 gateway를 실제 API 게이트웨이의 5대 책임(라우팅, 인증/인가, 변환, 정책,
관측) 기준으로 냉정하게 감사한 결과, 인증/인가만 완전히 구현돼 있고 나머지 4개는 부분적이거나
전혀 없었다. 4개를 순서대로 채워서 gateway를 이름값 하는 상태로 만든다.

## 현재 상태 (AS-IS) — 감사 결과

| 항목 | 상태 | 근거 |
|---|---|---|
| 라우팅(포트 은닉) | 부분 구현 | gRPC 포트는 host 미노출이지만, orchestrator(3301)/order-service(3302)의 HTTP 포트(health/metrics)는 host에 그대로 노출됨 |
| 인증/인가 | **완전 구현** | 하위 서비스에 인증 코드 0건, gateway만 JwtAuthGuard/RolesGuard 보유 |
| 변환 | 부분 구현 | 응답 포맷 통일(`ResponseInterceptor`)은 있음. gRPC 에러→HTTP 상태코드 매핑 없음(지금은 뭉뚱그려 500) |
| 정책 | 전혀 없음 | rate limiting, throttling, IP 차단, CORS 미구현 |
| 관측 | 전혀 없음 | trace ID 발급/전파 없음, 요청 단위 access log 없음(`/health`, `/metrics`는 있지만 이건 인프라 헬스체크지 요청 추적이 아님) |

## 변경 후 상태 (TO-BE)

4단계로 순서대로 채운다(사용자 확정 순서):

1. **포트 은닉 완성** — orchestrator/order-service의 host 포트 노출 제거, gateway(3300)만
   유일한 host 진입점으로 만든다.
2. **관측** — W3C `traceparent` 표준으로 gateway가 trace ID를 발급(또는 들어온 걸 재사용)하고,
   gRPC metadata로 하위 서비스까지 전파. 각 프로세스가 요청 단위 access log(method/path
   또는 gRPC method, status, 소요시간, traceId)를 남겨서 "장애 시 traceId 하나로 전체 경로
   로그를 grep"할 수 있게 한다.
3. **변환** — gRPC status code(`UNAVAILABLE`, `NOT_FOUND` 등)를 적절한 HTTP status로 매핑하는
   전역 예외 필터 추가.
4. **정책** — `@nestjs/throttler`로 rate limiting(IP 또는 사용자 단위), CORS 최소 설정,
   간단한 IP 차단 미들웨어.

## 변경 범위

| 파일/디렉토리 | 변경 내용 |
|---|---|
| `docker-compose.yml` | orchestrator/order-service의 `ports:` 섹션 제거 |
| `src/shared/trace/*` (신규) | `traceparent` 파싱/생성, `AsyncLocalStorage` 기반 요청 컨텍스트 |
| `src/gateway/middleware/trace.middleware.ts` (신규) | 들어오는 요청의 traceparent 처리, 컨텍스트 저장, 응답 헤더 세팅 |
| `src/*/interceptors/grpc-trace.interceptor.ts` (신규, 각 gRPC 서버) | 들어오는 gRPC metadata에서 traceparent 읽어 컨텍스트 저장 |
| gRPC 클라이언트 wrapper들(`orchestrator-grpc-client.ts` 등) | 나갈 때 metadata에 traceparent 첨부 |
| `src/*/interceptors/access-log.interceptor.ts` (신규, 전 프로세스) | 요청/응답 단위 구조화 로그 |
| `src/gateway/filters/grpc-status.filter.ts` (신규) | gRPC status → HTTP status 매핑 |
| `src/gateway/app.module.ts` | `@nestjs/throttler` 등록, `app.enableCors()` |
| `package.json` | `@nestjs/throttler` 추가 |

## 영향성

| 영향 대상 | 영향 내용 |
|---|---|
| 다른 실험(waiting-room 등) | 변경 없음 |
| node-forge | 이번 라운드 스코프에서는 수정 없음. 관측(trace ID 전파, access log) 구현이 검증되면 그 설계를 근거로 제안서 작성 예정(gRPC를 쓰는 모든 서비스가 필요로 할 뻔한 기능이라 forge 후보로 유력) — 사용자와 확인 후 진행. rate limiting은 `@nestjs/throttler`가 이미 표준 라이브러리라 forge 제안 없이 로컬로만 사용(사용자 확정) |

## Breaking Changes

없음. orchestrator/order-service의 host 포트를 로컬에서 직접 curl로 확인하던 습관이 있다면
그건 안 되게 되지만(`docker exec`으로 대체), 이건 이 랩의 개발 편의 손실일 뿐 실제 기능 손실은
아니다.

## 위험도

**MEDIUM** — 여러 프로세스에 걸쳐 공통 코드(trace context, access log)를 추가하는 작업이라
범위가 넓지만, 각 프로세스가 독립적이라 하나씩 순서대로 추가하고 검증할 수 있어 한 번에
전체가 깨질 위험은 낮다.

## 주의사항

- gRPC metadata로 traceparent를 전파할 때, `@nestjs/microservices`의 `ClientGrpc`가 메타데이터
  주입을 어떻게 지원하는지(인터셉터 vs 매 호출마다 수동 첨부) 먼저 확인 필요 — API가 생각보다
  번거로우면 클라이언트 wrapper 메서드 시그니처에 traceId를 명시적으로 받는 방식으로 단순화한다.
- `AsyncLocalStorage`는 Node.js 표준 기능이라 추가 의존성 없이 구현 가능 — 굳이 외부 라이브러리
  (`cls-hooked` 등) 안 씀.
- access log가 너무 장황해지지 않도록(payload 전체를 찍지 않기 등) 필드를 method/path/status/
  durationMs/traceId 정도로 제한.

## 작업 단계

### 1단계: 포트 은닉 완성

1. `docker-compose.yml`에서 orchestrator/order-service의 `ports:` 섹션 제거
2. 재기동 후 host에서 3301/3302로 접근 안 되는지, gateway(3300)를 통한 정상 흐름은 그대로인지 확인

### 2단계: 관측(trace ID + access log)

1. `traceparent` 파싱/생성 유틸 + `AsyncLocalStorage` 컨텍스트
2. gateway 미들웨어(들어오는 요청 처리) + gRPC 클라이언트 wrapper(나가는 메타데이터 첨부)
3. 각 gRPC 서버(orchestrator/order-service/inventory-service)의 인터셉터(들어오는 메타데이터 처리)
4. 전 프로세스에 access log 인터셉터 추가
5. 검증되면 node-forge 제안 여부를 사용자와 재확인

### 3단계: 변환(gRPC 에러 → HTTP 매핑)

1. gRPC status code → HTTP status 매핑 필터 작성
2. orchestrator를 일부러 내려서(`docker stop`) gateway가 503을 정확히 반환하는지 실제 재현

### 4단계: 정책(rate limit/CORS/IP 차단)

1. `@nestjs/throttler` 등록, 적절한 한도 설정
2. `app.enableCors()` 최소 설정
3. 간단한 IP 차단 미들웨어(데모용 deny list)
4. 실제로 한도를 넘겨서 429가 나는지 재현

## 검증 방법

- 각 단계마다 Docker로 실제 재현(이 세션 전체의 원칙 — 이론이 아니라 실측)
- 4단계 다 끝난 뒤, 5대 기능 감사표를 다시 채워서 전부 "완전 구현"으로 바뀌었는지 재확인

## 참조 규칙

- `rules/common/principles.md` — node-forge 제안은 로컬 검증 후(관측 항목), rate limiting은
  표준 라이브러리라 제안 없이 로컬로만(정책 항목) — 사용자와 논의로 확정
