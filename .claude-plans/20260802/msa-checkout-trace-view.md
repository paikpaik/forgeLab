## 플랜 실행 이력

### 완료: 2026-08-02

**결과**: 성공. 계획한 3단계 전부 완료.

**실제 변경 파일**: 계획한 15개 파일 전부(docker-compose.yml, checkout.proto,
saga-instance.entity.ts, trace-recorder.ts 신규, saga.service.ts, saga.controller.ts,
orchestrator.module.ts, order.controller.ts, order.module.ts, inventory.controller.ts,
inventory.module.ts, orchestrator-grpc-client.ts, checkout.controller.ts,
traces.controller.ts 신규, gateway.module.ts, panel.html) + `saga.service.test.ts`(생성자
시그니처 변경에 맞춰 fake TraceRecorderService 추가).

**계획과의 차이**: 없음 — 설계한 그대로 구현됨.

**검증(2026-08-02, 실제 컨테이너)**: 4개 프로세스 전부 재빌드 후 DI 에러 없이 정상 기동.
해피 패스 체크아웃 하나를 끝까지(CONFIRMED) 흘려보낸 뒤 `GET /admin/traces/:sagaId`에서
gateway/orchestrator/order-service/inventory-service 9개 스팬이 **전부 같은 traceId**로
시간순 정확히 기록된 것 확인(gateway 처리 시점과 폴러가 몇 초 뒤 처리한 시점 사이의 간격에도
불구하고). widget-scarce 재고 0으로 만들어 보상(COMPENSATING→CANCELLED) 경로도 재현해
`order-service/CancelOrder`까지 같은 traceId로 잡히는 것 확인. 유닛 테스트 22개 회귀 없음.

**잔존 작업**: 없음. 상세 내용은 `services/msa-checkout/ARCHITECTURE.md`의 "후속
(2026-08-02) — 정밀 트레이스/gRPC 뷰" 절 참고.

---

# msa-checkout-trace-view — 정밀 트레이스/gRPC 뷰(saga 폴러 경계를 넘어 이어지는 트레이스)

## 목표

gateway→orchestrator→order-service/inventory-service로 이어지는 실제 gRPC 호출 체인을,
saga가 실제로 처리되는 시점(`SagaProcessorService`의 `@Interval` 폴러, 원래 HTTP 요청과
비동기적으로 끊어져 있음)까지 포함해서 하나의 traceId로 재구성해 보여주는 개발자 콘솔
탭을 추가한다. 사용자가 "실무에서 중요한가/forge 수정이 필요한가"를 먼저 확인했고, 둘 다
아니오(forge 수정 불필요)/예(실무 중요)로 답이 나와서 정밀 버전으로 진행하기로 확정함.

## 현재 상태 (AS-IS)

- trace 전파 자체(`generateTraceId`/`runWithRequestContext`/`getRequestContext`/
  `buildOutgoingTraceMetadata`/`TraceAccessLogMiddleware`/`GrpcTraceAccessLogInterceptor`)는
  이미 node-forge 1.0.7/1.0.8로 구현·검증돼 있고, gateway→orchestrator의 `StartCheckout`
  호출까지는 같은 traceId로 이어짐.
- 그러나 실제로 order-service/inventory-service를 호출하는 건 `SagaProcessorService`의
  `@Interval` 폴러(`saga-processor.service.ts`)가 나중에 비동기로 하는 일이라, 그 시점에는
  `getRequestContext()`가 `undefined`를 반환한다(ARCHITECTURE.md에 이미 "의도적으로
  미수정"이라 문서화된 기존 한계) — 즉 지금 상태로 트레이스를 눈으로 보면 gateway+orchestrator
  접수까지 2홉만 이어지고, 정작 궁금한 order/inventory 호출은 전부 별개 trace로 끊겨 보인다.
- msa-checkout은 Redis를 아예 안 씀(ARCHITECTURE.md에 명시된 설계 결정) — 스팬을 어딘가
  저장하려면 저장소가 필요.
- trace 데이터를 어디에도 저장하지 않음(로그에만 찍힘) — UI로 보여줄 조회 가능한 소스가 없음.

## 변경 후 상태 (TO-BE)

1. **saga에 traceId 영속화**: `SagaInstanceEntity`에 `traceId` 컬럼 추가. `startCheckout()`이
   생성 시점의 `getRequestContext()?.traceId`(gateway로부터 이어진 원본 trace)를 저장한다.
2. **폴러가 저장된 traceId로 컨텍스트를 다시 연다**: `SagaService.driveStep()`이
   `runWithRequestContext({traceId: saga.traceId, requestId: 새로 발급}, ...)`로 감싸서,
   물리적으로는 원래 요청과 끊긴 실행이어도 논리적으로 같은 trace로 이어붙인다. 이
   컨텍스트 안에서 나가는 gRPC 호출(`buildOutgoingTraceMetadata()`)이 이 traceId를 담아
   order-service/inventory-service로 전파되고, 그쪽의 `GrpcTraceAccessLogInterceptor`가
   받아서 자기 컨텍스트로 다시 세운다 — forge 수정 없이 이미 공개된 API 조합만으로 해결.
3. **Redis 신규 도입 + 스팬 기록**: `src/shared/trace-recorder.ts`의 `TraceRecorderService`가
   각 프로세스(gateway/orchestrator/order-service/inventory-service)에서
   `{service, method, ok, durationMs, at}`를 `trace:{traceId}:spans` Redis 리스트에 기록.
   `withSpan()` 헬퍼로 각 컨트롤러 메서드를 감싸 최소 변경으로 계측.
4. **조회 API**: gateway에 `GET /admin/traces/:sagaId` 신규 — `GetSagaStatus`(proto에
   `traceId` 필드 추가)로 saga의 traceId를 얻은 뒤, 그 traceId로 Redis에서 스팬 목록을
   가져와 반환.
5. **UI**: panel.html 개발자 콘솔에 "트레이스" 탭 추가 — sagaId를 입력(또는 최근 체크아웃한
   sagaId 자동 채움)하면 gateway→orchestrator(StartCheckout)→(폴러 tick마다)
   orchestrator(drive:*)→order-service/inventory-service 순으로 이어지는 스팬을 시간순
   워터폴처럼 보여준다.

## 변경 범위

| 파일 | 변경 내용 |
|------|----------|
| `services/msa-checkout/docker-compose.yml` | `redis` 서비스 신규, gateway/orchestrator/order-service/inventory-service에 `REDIS_HOST`/`REDIS_PORT` 추가 |
| `services/msa-checkout/proto/checkout.proto` | `SagaStatusResponse`에 `traceId` 필드(11번) 추가 |
| `services/msa-checkout/src/orchestrator/entities/saga-instance.entity.ts` | `traceId` 컬럼(nullable) 추가 |
| `services/msa-checkout/src/shared/trace-recorder.ts` | 신규 — `TraceRecorderService`, `withSpan()`, `TraceSpan` 타입 |
| `services/msa-checkout/src/orchestrator/saga.service.ts` | `startCheckout`에서 traceId 캡처·저장, `SagaView`에 traceId 추가, `driveStep`을 `runWithRequestContext`로 감싸고 스팬 기록 |
| `services/msa-checkout/src/orchestrator/saga.controller.ts` | `withSpan`으로 StartCheckout/GetSagaStatus 계측 |
| `services/msa-checkout/src/orchestrator/orchestrator.module.ts` | `RedisModule.forRoot` + `TraceRecorderService` provider 추가 |
| `services/msa-checkout/src/order-service/order.controller.ts` | `withSpan`으로 3개 메서드 계측 |
| `services/msa-checkout/src/order-service/order.module.ts` | `RedisModule.forRoot` + `TraceRecorderService` |
| `services/msa-checkout/src/inventory-service/inventory.controller.ts` | `withSpan`으로 5개 메서드 계측 |
| `services/msa-checkout/src/inventory-service/inventory.module.ts` | `RedisModule.forRoot` + `TraceRecorderService` |
| `services/msa-checkout/src/gateway/clients/orchestrator-grpc-client.ts` | `SagaStatusGrpc`에 `traceId` 필드 추가 |
| `services/msa-checkout/src/gateway/checkout.controller.ts` | `withSpan`으로 체크아웃 시작 계측 |
| `services/msa-checkout/src/gateway/traces.controller.ts` | 신규 — `GET /admin/traces/:sagaId` |
| `services/msa-checkout/src/gateway/gateway.module.ts` | `RedisModule.forRoot` + `TraceRecorderService` + `TracesController` 등록 |
| `services/msa-checkout/public/panel.html` | 개발자 콘솔에 "트레이스" 탭 추가(워터폴 뷰) |

## 영향성

| 영향 대상 | 영향 내용 |
|-----------|----------|
| saga TCC 상태 전이 로직(tryOrder/tryInventory/confirmBoth/compensate) | 로직 자체는 변경 없음 — `runWithRequestContext`로 감싸고 스팬만 추가 |
| 기존 체크아웃/재고 API 응답 | `GetSagaStatus`에 필드 하나 추가(하위 호환, 기존 소비자는 무시하면 됨) |
| msa-checkout "Redis 없음" 설계 결정 | **뒤집힘** — 이번 작업의 명시적 스코프. 순수 트레이스 스팬 저장 전용으로만 씀(도메인 데이터는 여전히 Postgres) |
| 다른 서비스 | 변경 없음 |

## Breaking Changes

없음 — proto 필드 추가는 하위 호환. 기존 API 응답 스키마도 필드 추가만(제거/타입변경 없음).

## 위험도

**MEDIUM** — 인프라(Redis) 신규 도입 + 4개 프로세스 모두에 계측 코드 추가라 손대는 파일이
많음. 다만 saga TCC 전이 로직 자체는 안 건드리고 감싸기만 하므로 도메인 정합성 위험은 낮음.
gateway에서 겪었던 "AdminEventsModule을 App모듈이 아니라 Feature모듈에 넣어야 함" 패턴을
이번엔 처음부터 반영해서 재발 방지.

## 작업 단계

### 1단계: 인프라(Redis) + 데이터 모델(traceId 컬럼)

1. docker-compose.yml에 redis 추가, 4개 프로세스 env 추가
2. `SagaInstanceEntity`에 `traceId` 컬럼

### 2단계: 트레이스 기록 공통 유틸 + 각 프로세스 계측

1. `src/shared/trace-recorder.ts` 작성
2. orchestrator: `saga.service.ts`(traceId 캡처+저장, driveStep 컨텍스트 재수립+스팬),
   `saga.controller.ts`(withSpan), `orchestrator.module.ts`(Redis+TraceRecorder 등록)
3. order-service/inventory-service: 컨트롤러 계측 + 모듈에 Redis+TraceRecorder 등록
4. gateway: proto 필드 추가 반영(`orchestrator-grpc-client.ts`), `checkout.controller.ts`
   계측, `traces.controller.ts` 신규, `gateway.module.ts`에 등록

### 3단계: UI + 검증

1. panel.html 개발자 콘솔에 "트레이스" 탭
2. Docker 재빌드(4개 프로세스 전부)·재기동
3. curl로 체크아웃 → 몇 초 대기(폴러가 여러 tick 처리) → `GET /admin/traces/:sagaId`로
   gateway/orchestrator/order-service/inventory-service 스팬이 **같은 traceId**로 전부
   기록된 것 확인
4. `services/msa-checkout/ARCHITECTURE.md`에 이번 변경 이력 추가(Redis 도입 결정 이유 포함)

## 검증 방법

- 체크아웃 하나를 끝까지(CONFIRMED) 흘려보낸 뒤 `/admin/traces/:sagaId` 응답에서
  `gateway/orchestrator/order-service/inventory-service` 4개 서비스명이 전부 같은 traceId
  아래 스팬으로 잡히는지 확인 — 이게 이번 작업의 핵심 성공 기준
- 기존 vitest 스위트 회귀 없음 확인

## 참조 규칙

- `.claude/rules/common/principles.md` — Redis 도입은 저장소 구조를 바꾸는 결정이라
  사용자에게 먼저 확인 후 진행(완료)
