## 플랜 실행 이력

### 완료: 2026-08-02

**결과**: 성공

**실제 변경 파일**: 플랜의 "변경 범위" 표대로 전부 신규 생성됨(`services/payment-gateway/`
전체 — package.json/tsconfig/vitest.config/Dockerfile/docker-compose.yml/forge-lab.json,
`src/app/*`, `src/fake-pg/*`, `src/shared/*`, `src/test-utils/*`, `public/panel.html`,
`public/checkout-widget.html`, `ARCHITECTURE.md`), 더해서 `docs/architecture.md`(디렉토리
트리/mermaid S7 노드+엣지+클래스 반영).

**계획과의 차이**:
- 실제 Docker 검증 중 계획에 없던 버그를 발견해서 즉시 수정함 — `ForgeHttpClient`의
  재시도가 fake-pg의 타임아웃 시뮬레이션 도중에 발동하면, fake-pg의 clientReference 멱등성
  체크가 재시도 요청에 "PROCESSING"을 바로 응답해버려서 거래가 `PENDING`+`pgTransactionId`
  상태로 영원히 멈추는 경로가 있었다(아무도 웹훅을 안 보내주므로). `reconcile()`/
  `listInDoubt()`를 `IN_DOUBT`뿐 아니라 이 상태도 포함하도록 확장해서 해결 — 상세 배경은
  `ARCHITECTURE.md`의 "후속 발견" 섹션 참고. 유닛 테스트도 이 케이스를 커버하도록 추가함
  (`payment.service.test.ts`, 총 11개 통과).
- 그 외에는 계획대로 진행 — 상태머신(PENDING/CONFIRMED/FAILED/IN_DOUBT/DEAD), clientReference
  선(先)생성, ForgeHttpClient+DistributedCircuitBreaker 조합, versioning(v1/v2) 전부 계획된
  설계 그대로 구현됨.

**잔존 작업**: 없음. 실제 컨테이너로 5개 시나리오(정상 승인/버전 협상/서킷브레이커 OPEN/
타임아웃→reconciler 자동 해소/비동기 웹훅/멱등성) 전부 검증 완료.

---

# payment-gateway-service — 7번째 실험: 외부 결제대행사 연동 게이트웨이

## 목표

지금까지 6개 실험이 안 쓴 node-forge의 `http`(`ForgeHttpClient`, 아웃바운드 axios 래퍼)와
`versioning`(Accept-Version 헤더 기반 API 버전 협상)을 검증한다. "우리 시스템이 아니라
밖으로 나가는 호출이 실패할 때"를 다루는 첫 실험으로, 불안정한 외부 PG(결제대행사)를 흉내
낸 `fake-pg`를 호출하면서 재시도/분산 서킷브레이커/비동기 콜백/거래 조회(reconciliation)를
전부 실제로 겪어보고, 그 과정에서 트랜잭션이 절대 유실되거나 중복 처리되지 않는지 검증한다.

## 현재 상태 (AS-IS)

`services/` 아래 6개 실험(waiting-room/live-ranking/order-outbox/msa-checkout/
webhook-relay/live-auction) 모두 각자의 forge 모듈 조합을 검증했지만, `@paikpaik/node-forge`의
`http`, `versioning` 모듈은 어느 서비스에서도 import된 적이 없다(`grep -rl "node-forge/http\|
node-forge/versioning" services/`로 확인, 결과 없음). `core/circuit-breaker`(인메모리)와
`redis/circuit-breaker`(분산)는 webhook-relay가 이미 검증했지만, 그건 "우리에게 들어오는
웹훅을 배달"하는 방향이었지 "우리가 밖으로 나가는 호출"을 보호하는 데는 아직 안 쓰였다.

`ForgeHttpClient` 자체에는 서킷브레이커가 없다(고정 지연 재시도 인터셉터 + 로깅/메트릭
인터셉터만 제공, `forge/node-forge/src/http/http.ts` 확인) — 그래서 이 실험은
`ForgeHttpClient`(재시도)와 `DistributedCircuitBreaker`(회로 차단)를 함께 조합해서 쓴다.

## 변경 후 상태 (TO-BE)

`services/payment-gateway/`가 신설되고, 두 프로세스로 분리된다(msa-checkout/webhook-relay와
같은 다중 프로세스 패턴):

- **app**(포트 3600) — 가맹점 대상 결제 게이트웨이 BFF. 결제 생성/조회 API, 웹훅 콜백 수신,
  거래조회 폴러(reconciler), 관리자 API, panel.html(가맹점 콘솔)+checkout-widget.html(쇼핑몰
  결제창 데모) 서빙.
- **fake-pg**(포트 3601) — 실제 외부 PG를 흉내 내는 테스트 더블. 설정 가능한 확률로
  성공/거절/타임아웃/서버에러/비동기 응답을 시뮬레이션하고, `clientReference`로 조회 가능한
  거래조회 엔드포인트를 제공한다. dashboard에는 노출 안 함(`forge-lab.json` 없음 — app만
  대표 UI를 가짐, msa-checkout의 order-service/inventory-service와 같은 취급).

### 트랜잭션 상태머신

```
PENDING --(PG 동기 승인)--> CONFIRMED
PENDING --(PG 동기 거절/명시적 에러 응답)--> FAILED
PENDING --(회로 OPEN, PG 호출 자체를 안 함)--> FAILED  (호출 안 했으니 모호함 없음)
PENDING --(PG 비동기 접수, 202)--> PENDING (유지, 웹훅 대기)
PENDING --(응답 자체를 못 받음: 타임아웃/커넥션 에러)--> IN_DOUBT
IN_DOUBT --(reconciler가 거래조회로 확인)--> CONFIRMED / FAILED
IN_DOUBT --(N회 재조회에도 미해소)--> DEAD (운영자 확인 대상)
PENDING --(웹훅 콜백 도착)--> CONFIRMED / FAILED
```

**IN_DOUBT는 오직 "응답 자체를 못 받은 경우"에만 진입한다** — PG가 명시적으로 거절/에러를
응답했으면 그 자체가 확정 정보이므로 FAILED로 바로 처리한다. 이 구분이 이 실험의 핵심
설계 결정이다(사용자와 채팅으로 먼저 합의한 상태머신).

### 재조회 키 문제 해결 — `clientReference`

타임아웃이 PG의 응답을 받기 전에 발생하면 `pgTransactionId`를 모른다. 그래서 우리가 호출
"전에" 트랜잭션 PK와 별개로 `clientReference`(UUID)를 미리 생성해 PG 요청에 실어 보내고,
`fake-pg`는 `clientReference`로도 조회 가능한 엔드포인트(`GET /pg/charge/by-reference/:ref`)를
제공한다 — 응답을 못 받아도 reconciler가 항상 조회할 키를 갖도록 하기 위함.

## 변경 범위

| 파일 | 변경 내용 |
|------|----------|
| `services/payment-gateway/package.json` | 신규. `@paikpaik/node-forge`, NestJS, TypeORM, pg 등 기존 서비스와 동일 템플릿 |
| `services/payment-gateway/tsconfig.json`, `vitest.config.ts` | 신규. 기존 서비스 템플릿 그대로 |
| `services/payment-gateway/Dockerfile` | 신규. app/fake-pg 공용(기존 다중 프로세스 서비스 패턴) |
| `services/payment-gateway/docker-compose.yml` | 신규. `app`(3600), `fake-pg`(3601, 호스트 포트 미노출 또는 디버깅용 노출), `postgres`(`payment_gateway` db), `redis` |
| `services/payment-gateway/forge-lab.json` | 신규. `{ "panelUrl": "http://localhost:3600/panel.html", "architectureDoc": "ARCHITECTURE.md" }` |
| `src/app/entities/payment-transaction.entity.ts` | 신규. `PaymentTransactionEntity` |
| `src/app/entities/payment-attempt.entity.ts` | 신규. `PaymentAttemptEntity`(감사 이력) |
| `src/app/dto/create-payment.dto.ts` | 신규. `{merchantId, amount: @Min(1), idempotencyKey?}` |
| `src/app/payment.service.ts` | 신규. 결제 생성(멱등성 dedupe)+PG 호출(ForgeHttpClient+DistributedCircuitBreaker)+웹훅 처리+거래조회 |
| `src/app/payment.controller.ts` | 신규. `POST /payments`, `GET /payments/:id`(ApiVersion으로 v1/v2 응답 분기), `POST /webhooks/pg-callback` |
| `src/app/admin.controller.ts` | 신규. `GET /admin/payments/dead`, `POST /admin/payments/:id/reconcile`, fake-pg flakiness 설정 프록시 |
| `src/app/payment-reconciler.service.ts` | 신규. `@Interval` — IN_DOUBT 거래를 거래조회로 재확인, N회 초과 시 DEAD |
| `src/app/payment.module.ts` | 신규. `RedisModule.forRoot`, `AdminEventsModule.forRoot`, `ScheduleModule.forRoot` |
| `src/app/app.module.ts`, `src/app/main.ts` | 신규. 표준 부트스트랩 |
| `src/fake-pg/fake-pg.controller.ts` | 신규. `POST /pg/charge`(확률적 성공/거절/타임아웃/5xx/비동기), `GET /pg/charge/:pgTransactionId`, `GET /pg/charge/by-reference/:ref` |
| `src/fake-pg/fake-pg-admin.controller.ts` | 신규. `POST /admin/fake-pg/config`(failureRate/timeoutRate/asyncRate/latencyMs) |
| `src/fake-pg/fake-pg.module.ts`, `src/fake-pg/main.ts` | 신규 |
| `public/panel.html` | 신규. 가맹점 결제 연동 콘솔(결제 폼+목록+시도 이력 타임라인+fake-pg flakiness 테스트 도구) + `mountDevConsole` |
| `public/checkout-widget.html` | 신규. 쇼핑몰 결제창 데모(폴링, 서킷 오픈 시 폴백 UX) |
| `src/app/payment.service.test.ts` | 신규. 유닛 테스트(FakeHttpClient/FakeCircuitBreaker로 재시도·회로차단·IN_DOUBT·멱등성 검증) |
| `docs/architecture.md` | 7번째 실험 디렉토리 트리/mermaid 노드 추가 |
| `services/payment-gateway/ARCHITECTURE.md` | 신규. 이 서비스 상세 설계 문서 |

## 영향성

| 영향 대상 | 영향 내용 |
|-----------|----------|
| 기존 6개 서비스 | 변경 없음(완전히 독립된 신규 workspace 패키지) |
| dashboard | `forge-lab.json` 스캔으로 자동 인식, dashboard 코드 변경 없음 |
| node-forge/kafka-forge | 변경 없음(기존 공개 API인 `http`, `redis` circuit-breaker, `versioning`만 사용 — 제안서 불필요) |

## Breaking Changes

없음 (완전 신규 서비스)

## 위험도

**MEDIUM** — 신규 서비스라 다른 실험에 영향은 없지만, 상태머신(PENDING/CONFIRMED/FAILED/
IN_DOUBT/DEAD)과 멱등성 키 설계가 이 실험 내부적으로는 핵심 로직이라 실수 여지가 있다.

## 주의사항

- `fake-pg` 호출은 반드시 `DistributedCircuitBreaker.execute(key, fn)`으로 감싼 뒤 그 안에서
  `ForgeHttpClient.post(...)`를 호출한다 — 순서를 반대로 하면 회로가 열려도 매번 실제
  호출을 시도하게 된다.
- 회로가 이미 OPEN이라 `fn`을 아예 호출 안 한 케이스(`ForgeError('E9502')`)는 IN_DOUBT가
  아니라 즉시 FAILED로 처리한다 — PG를 호출하지 않았으니 모호함이 없다는 걸 놓치지 않는다.
- 타임아웃/커넥션 에러(응답 자체가 없는 경우)만 IN_DOUBT로 보낸다. PG가 명시적으로 4xx/5xx를
  응답했다면 그건 이미 확정 정보이므로 FAILED다.
- `clientReference`는 PG 호출 "전에" 생성해서 요청에 실어 보낸다 — 호출 후에 만들면 응답을
  못 받았을 때 재조회할 키가 없어진다.
- `ForgeHttpClient`의 내장 재시도(`options.retries`, 고정 지연)와 서킷브레이커는 별개다 —
  재시도가 다 소진된 뒤에야 실패로 간주되고, 그 실패가 회로의 실패 카운터에 반영된다.

## 작업 단계

### 1단계: 스켈레톤 + 엔티티

1. `package.json`/`tsconfig.json`/`vitest.config.ts`/`Dockerfile`/`docker-compose.yml`/
   `forge-lab.json` 기존 서비스 템플릿대로 생성
2. `PaymentTransactionEntity`/`PaymentAttemptEntity` 작성, `DatabaseModule.forRoot`에 등록

### 2단계: fake-pg (테스트 더블)

1. `POST /pg/charge` — `clientReference`를 받아 확률적으로 승인/거절/타임아웃(지연 후 무응답
   대신 커넥션 종료로 흉내)/5xx/비동기(202 후 지연 콜백) 분기
2. `GET /pg/charge/:pgTransactionId`, `GET /pg/charge/by-reference/:ref` — 거래조회
3. `POST /admin/fake-pg/config` — flakiness 파라미터 런타임 조정

### 3단계: app 핵심 로직

1. `PaymentService.createPayment()` — 멱등성 dedupe(기존 idempotencyKey 있으면 그 상태 반환) →
   `clientReference` 생성 → `DistributedCircuitBreaker.execute()`로 감싼 `ForgeHttpClient` 호출
   → 결과에 따라 CONFIRMED/FAILED/PENDING(비동기 대기)/IN_DOUBT 분기 → `PaymentAttemptEntity`
   기록
2. `POST /webhooks/pg-callback` — `clientReference` 또는 `pgTransactionId`로 트랜잭션 조회 후
   PENDING → 최종 상태 전이
3. `PaymentReconcilerService`(`@Interval`) — IN_DOUBT 대상 재조회, 해소 또는 DEAD 전환
4. `GET /payments/:id`를 `@ApiVersion({defaultVersion:'v2', supportedVersions:['v1','v2']})`로
   분기해서 v1은 `{id,status}`, v2는 `{id,status,attempts,pgTransactionId,reconcileAttempts}` 반환
5. `/admin/payments/dead`, `/admin/payments/:id/reconcile` 관리자 API

### 4단계: UI

1. `panel.html` — 결제 폼(apiVersion 토글 포함)+목록(상태 dot)+클릭 시 시도 이력 타임라인+
   fake-pg flakiness 테스트 도구, `PanelUI.mountDevConsole`로 원시 상태/로그 이동
2. `checkout-widget.html` — 폴링 기반 결제 진행 화면, 회로 OPEN/IN_DOUBT 상태에 대한 폴백 UX

### 5단계: 테스트 + 검증

1. 유닛 테스트: 정상 승인, 명시적 거절(FAILED, IN_DOUBT 아님), 회로 OPEN 시 즉시 FAILED,
   타임아웃 시 IN_DOUBT, 멱등성 키 재요청 시 중복 생성 안 됨, reconciler가 IN_DOUBT를
   해소하는 케이스
2. Docker로 실제 기동 후: fake-pg 실패율을 100%로 올려 회로가 OPEN되는지, 그 상태에서 결제가
   즉시 FAILED로 응답하는지, 타임아웃 시나리오에서 IN_DOUBT→reconciler가 해소하는지 실측
3. `docs/architecture.md`/`ARCHITECTURE.md` 갱신

## 검증 방법

- 유닛 테스트 전부 통과
- `tsc --noEmit` 클린
- 실제 컨테이너: (1) fake-pg 정상 → 결제 즉시 CONFIRMED, (2) fake-pg 명시적 거절 → 즉시
  FAILED(회로 실패 카운트에는 안 잡힘, 정상 응답이므로), (3) fake-pg 타임아웃 다발 → 회로
  OPEN 전환 확인 + 그 상태에서 새 결제가 PG 호출 없이 즉시 FAILED로 응답, (4) 개별 타임아웃
  1건 → IN_DOUBT 진입 후 reconciler가 거래조회로 해소, (5) 같은 idempotencyKey로 재요청 →
  새 트랜잭션 생성 안 되고 기존 상태 반환

## 참조 규칙

- `.claude/rules/project/convention.md` — 실험 구조, forge 의존성 명시 방식, Admin API 네이밍(`/admin/*`), 패널 공유 UI(`@forge-lab/panel-ui`) 사용법, 페르소나+개발자콘솔+목적지 데모 패턴
- `.claude/rules/common/principles.md` — forge 패키지는 직접 수정 안 함(이번 실험은 기존 공개 API만 쓰므로 해당 없음), 필요 이상 확장 금지
