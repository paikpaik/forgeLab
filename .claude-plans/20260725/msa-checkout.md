# msa-checkout — API 게이트웨이 + gRPC + Orchestration Saga 실험

## 플랜 실행 이력

### 후속: 2026-07-25 (node-forge 1.0.6 채택 — `RolesGuard` DI 버그 수정 반영)

바로 앞 라운드에서 재현·제안한 `RolesGuard` DI 버그가 1.0.6으로 수정됐다는 알림. 실제 커밋
(`3638c25`)을 읽어 확인 — 제안한 대로 `@Inject(Reflector)`가 추가됐고, 같은 원인의 버그가
있던 `EventsExplorer`도 함께 발견해 수정됐으며, 스모크 테스트에 실제 배포 dist의 DI 메타데이터
검증과 `EventsModule` 부팅 테스트까지 추가됨(제안서의 "실제 설치해서 실행해야 드러난다"는
지적을 CI에 반영).

**실제 변경 파일**:
- `package.json` — node-forge `^1.0.5` → `^1.0.6`
- `src/gateway/roles-guard.workaround.ts` 삭제
- `gateway.module.ts`/`checkout.controller.ts`/`admin.controller.ts` — `RolesGuard` import를
  forge 공식 경로로 되돌림
- `ARCHITECTURE.md`, `docs/issues.md` 갱신(RolesGuard 버그를 1.0.6 대응 결과로 표에 추가)

**검증**: 우회 코드 완전 제거 상태로 재빌드 후 실제 컨테이너에서 정상 체크아웃(201)/인가
실패(403)/admin 정상 처리(201) 재확인 — 버그가 실제로 없어졌음을 동일 케이스로 증명. vitest
22개, tsc 클린.

**계획과의 차이**: 없음.

**잔존 작업**: 없음.

---

### 후속: 2026-07-25 (node-forge 1.0.5 채택 — `grpc`/`auth` 모듈로 로컬 우회 걷어냄)

앞서 쓴 두 제안서(gRPC 라운드로빈 헬퍼, JWT auth 모듈)가 node-forge 1.0.5로 반영됐다는
사용자 알림 — 이 세션 전체에서 반복해온 "버전 업 알림 → 실제 소스 확인 → 로컬 우회 제거 →
공식 API로 전환 → 실제 재검증 → 제안서/문서 업데이트" 흐름을 그대로 따랐다.

**실제 변경 파일**:
- `package.json` — node-forge `^1.0.5`, `@nestjs/jwt` 제거
- `src/shared/grpc-client.util.ts` 삭제, `src/shared/auth/*` 전체 삭제
- 4개 프로세스의 `main.ts`/`*.module.ts`에서 `@paikpaik/node-forge/grpc/nestjs`의
  `createGrpcClientOptions`/`createGrpcServerOptions` 직접 사용
- `src/gateway/{auth,checkout,admin}.controller.ts` — `@paikpaik/node-forge/auth`,
  `auth/nestjs` 사용으로 전환, `req.user!.userId` → `req.user!.sub`
- `src/gateway/roles-guard.workaround.ts` 신규 — 아래 버그 우회
- 로컬 auth 유닛테스트 11개 삭제 (node-forge 자체 테스트로 커버)
- `proposals/node-forge/20260725/20260725-roles-guard-di-broken.md` 신규
- `ARCHITECTURE.md`, `docs/issues.md` 갱신

**실제로 겪은 문제**:
1. `RolesGuard` DI 실패(HIGH) — 실제 배포된 `dist`를 직접 열어서 원인 확인(`Reflector` 타입
   추론에만 의존하는데 tsup/esbuild가 `emitDecoratorMetadata`를 방출 안 함). `useFactory`
   명시 주입도 실패해서 로컬 서브클래싱으로 최종 우회. 제안서 작성.
2. gRPC 라운드로빈이 "안 되는 것처럼" 보였던 사례 — 실제로는 버그가 아니라 이미 뜬
   orchestrator가 나중에 추가된 inventory-service 인스턴스를 즉시 재해석 못 하는 grpc-js
   특성. orchestrator 재시작 후 정상 분산 재확인.

**검증**: JWT 발급/인증/인가/변조 거부 전부 실제 컨테이너 재확인, gRPC 라운드로빈 재확인
(orchestrator 재시작 후 두 인스턴스 모두 트래픽 증가), saga 21건 CONFIRMED, vitest 22개 통과.

**계획과의 차이**: `RolesGuard` DI 버그는 계획에 없던 발견 — 재현·우회·제안서까지 이번
라운드 안에서 전부 처리.

**잔존 작업**: `roles-guard-di-broken` 제안서 반영 확인 — 반영되면 로컬 서브클래싱
(`roles-guard.workaround.ts`)을 지우고 forge의 `RolesGuard`로 되돌린다.

---

### 후속: 2026-07-25 (HMAC 자체 구현 → JWT(`@nestjs/jwt`) 교체)

사용자가 "forge의 목적은 forge-lab이 아니라 실제 forge 고도화이고, 회원 인증 bearer 토큰은
JWT가 표준"이라고 지적 — 방금 작성한 HMAC 프리미티브 제안서를 철회하고, msa-checkout의
인증을 실제 JWT로 교체해 검증한 뒤 JWT 모듈 제안서를 쓰는 순서로 재합의.

**실제 변경 파일**:
- `package.json` — `@nestjs/jwt` 추가
- `src/shared/auth/auth-token.service.ts` — `JwtService.sign`/`verify` 기반으로 재작성
  (`AuthGuard`/`RolesGuard` 인터페이스는 변경 없음)
- `src/shared/constants.ts` — `AUTH_TOKEN_TTL_MS` → `AUTH_TOKEN_TTL`(문자열, `expiresIn` 형식)
- `src/gateway/gateway.module.ts` — `JwtModule.register({ secret, signOptions })` 추가
- `src/shared/auth/auth-token.service.test.ts` — JWT 구조/변조/타 secret/만료 테스트로 재작성(7개)
- `ARCHITECTURE.md` — 설계 결정 표 갱신, "HMAC→JWT 교체" 후속 섹션 추가
- `proposals/node-forge/20260725/20260725-signed-token-primitive.md` 삭제,
  `20260725-jwt-auth-module.md` 신규 작성

**검증**: 실제 컨테이너에서 JWT 발급(표준 3-segment, `sub`/`role`/`iat`/`exp` 클레임 확인),
payload 변조 시 401(원본은 200 대조 확인), TTL 3초 임시 컨테이너로 실제 만료(4초 후 401)까지
재현. vitest 33개 전부 통과.

**계획과의 차이**: 없음 — 사용자와 논의로 확정한 방향 그대로 진행.

**잔존 작업**: 없음.

---

### 후속: 2026-07-25 (orchestrator 크래시 복구 실제 재현)

이전 완료 라운드에서 "알려진 검증 공백"으로 남겨뒀던 항목 — orchestrator를 실제로 강제
종료했다가 재기동해서 saga가 이어지는지 — 을 재현했다.

**방법/결과**: 체크아웃 직후 0.3초 간격으로 saga 상태를 타이트 폴링해 `ORDER_TRIED`(주문
성공, 재고 예약 전) 순간 `docker kill`로 orchestrator 즉시 강제 종료 → 킬 직후 saga가
`ORDER_TRIED`에 정확히 멈춰있고 order-service엔 `PENDING` 주문, inventory-service엔 예약
없음을 확인 → `docker compose start orchestrator` 재기동 → **새 StartCheckout 호출 없이**
폴러가 자동으로 이어받아 `INVENTORY_TRIED`→`CONFIRMED`까지 완료, order-service의 주문 id도
크래시 전과 동일(중복 생성 없음)하게 `CONFIRMED` 반영됨을 확인.

부수 발견: `restart: unless-stopped`가 `docker kill` 직후 즉시 자동 재시작되지 않아 수동
재기동함(Docker 재시작 백오프로 추정, 이 실험의 정합성 결론과는 무관 — 관찰 사실로만 기록).

**계획과의 차이**: 없음(직전 라운드에서 명시적으로 이월한 잔존 작업 그대로 수행).

**실제 변경 파일**: `ARCHITECTURE.md`에 "후속(2026-07-25) — orchestrator 크래시 복구 실제
재현" 섹션 추가, 기존 "알려진 검증 공백" 문구 제거.

**잔존 작업**: gRPC/HMAC 인증 설계를 node-forge 제안서로 정리하는 것 — 다음 단계로 진행 예정.

---

### 완료: 2026-07-25

**결과**: 성공

**실제 변경 파일**:
- `services/msa-checkout/package.json`, `tsconfig.json`, `.npmrc`, `.env`, `vitest.config.ts` — 스캐폴딩
  (`@nestjs/microservices`, `@grpc/grpc-js`, `@grpc/proto-loader`, `typeorm`, `pg`, devDep
  `better-sqlite3`/`@types/express` 추가)
- `proto/order.proto`, `proto/inventory.proto`, `proto/checkout.proto` — gRPC 계약 3종
- `src/shared/*` — `grpc-client.util.ts`(dns:///+round_robin 헬퍼), `constants.ts`,
  `auth/auth-token.service.ts`(HMAC 토큰, waiting-room TokenService 패턴 재사용),
  `auth/auth.guard.ts`, `auth/roles.guard.ts`, `auth/roles.decorator.ts`
- `src/order-service/*` — `OrderEntity`(sagaId unique), `OrderService`(Try/Confirm/Cancel,
  멱등성), `OrderController`(gRPC), `app.module.ts`, `main.ts`(hybrid HTTP+gRPC)
- `src/inventory-service/*` — `InventoryEntity`+`ReservationEntity`, `InventoryService`(원자적
  조건부 UPDATE로 TryReserve, ResetStock/GetStock 관리용 RPC 포함, seedIfMissing으로 데모
  상품 2종 자동 시드), `InventoryController`, `app.module.ts`, `main.ts`
- `src/orchestrator/*` — `SagaInstanceEntity`, `SagaService`(상태기계 — STARTED→ORDER_TRIED→
  INVENTORY_TRIED→CONFIRMED, 실패 시 COMPENSATING→CANCELLED), `SagaProcessorService`(`@Interval`
  폴러, saga별 try/catch 격리), `SagaController`(gRPC), `clients/`(OrderClient/InventoryClient
  인터페이스 + gRPC 구현체), `orchestrator.module.ts`, `app.module.ts`, `main.ts`
- `src/gateway/*` — `AuthController`(토큰 발급), `CheckoutController`(customer 전용),
  `AdminController`(admin 전용 재고 리셋), `clients/`(orchestrator/inventory-admin gRPC 클라이언트),
  `gateway.module.ts`, `app.module.ts`, `main.ts`(panel.html 서빙)
- `src/test-utils/` — `create-test-data-source.ts`(SQLite in-memory, entities 인자로 받는 범용화),
  `fake-order-client.ts`, `fake-inventory-client.ts`
- 테스트 파일 5개(31 테스트): `shared/auth/auth-token.service.test.ts`,
  `shared/auth/roles.guard.test.ts`, `order-service/order.service.test.ts`,
  `inventory-service/inventory.service.test.ts`, `orchestrator/saga.service.test.ts`
- `Dockerfile`(이미지 1개, 프로세스는 `docker-compose.yml`의 `command:`로 구분),
  `docker-compose.yml`(gateway/orchestrator/order-service/inventory-service/postgres 5서비스),
  `docker/init-db.sql`(order_db/inventory_db/saga_db 3개 DB 생성)
- `public/panel.html` — 로그인(customer/admin) · 재고 현황 · 체크아웃 · saga 목록 ·
  "동시 체크아웃 2건 발사"(다중 인스턴스 경쟁 재현) · "인가 실패 재현" 버튼 · 가이드
- `forge-lab.json`, `ARCHITECTURE.md` — 신규
- `docs/architecture.md` — 4번째 실험 노드(S4) 추가

**계획과의 차이**:
- 플랜 초안 단계에서는 "재고 먼저 Try, 주문 나중"도 검토했으나, order 먼저 → inventory
  나중으로 확정(재고 부족 시나리오가 order-service의 CancelOrder gRPC 경로까지 실제로
  타도록 하기 위함 — ARCHITECTURE.md의 "이 실험만의 설계 결정" 참고)
- Dockerfile의 proto 배치 방식이 최초 구현과 달라짐: 처음엔 `copy:proto` npm 스크립트로
  `dist/proto/`(dist 안쪽)에 복사했는데, 이러면 dev 모드(ts-node-dev, `src/proto` 상대 경로
  기준)와 프로덕션 모드의 상대 경로 깊이가 어긋나 런타임에 `proto 파일을 찾을 수 없음` 오류로
  gRPC 서버 3개가 전부 부팅 실패. `public`과 동일하게 `proto/`를 `dist`의 형제 디렉토리로
  복사하는 방식으로 통일해서 해결(아래 검증 이력 참고)

**잔존 작업**:
- gRPC/HMAC 인증이 검증된 설계를 근거로 node-forge에 제안서 작성 — 이번 라운드 범위 밖,
  다음 라운드로 이월
- orchestrator를 실제로 강제 종료했다가 재기동해서 saga가 정확히 이어지는지의 실제 재현
  (`fetchPending`이 터미널이 아닌 saga를 다시 집어온다는 것은 vitest로만 확인, 컨테이너
  단위 크래시 재현은 시간상 이번 라운드에서 하지 않음 — ARCHITECTURE.md에 알려진 검증
  공백으로 명시)

---

## 목표

forge-lab의 4번째 실험. 지금까지 세 실험이 공통으로 남긴 공백(같은 서비스의 인스턴스 여러
개가 같은 자원에 동시 접근할 때의 정합성)을 다루면서, 동시에 forge-lab이 아직 검증한 적
없는 두 가지(API 게이트웨이의 인증/인가, gRPC 기반 서비스 간 통신)를 하나의 실험 안에서
통합적으로 검증한다. 분산 트랜잭션은 orchestration saga 패턴으로, gRPC를 트랜잭션 조율의
핵심 통신 수단으로 삼는다(선택 이유: choreography/Kafka 방식은 gRPC가 트랜잭션 조율에서
빠지게 되어 이번 실험의 취지와 어긋남 — 대화 중 사용자와 합의).

## gRPC/HMAC 인증을 forge로 올리는 시점에 대한 결정

gRPC 통신, 게이트웨이 HMAC 인증 둘 다 이번이 forge-lab에서 처음 필요해지는 것이라, node-forge
에 바로 추가하지 않고 **이 실험 안에서 로컬로 구현 → 실제로 동작 검증 → 검증된 설계를 근거로
그때 제안서 작성**하는 순서로 간다. 이유는 두 가지:
1. 지금까지 forge에 들어간 기능(zadd NX, claim/release, markFailed 등)은 전부 실제 소비자가
   구체적인 필요에 부딪혀서 나온 것이지, 미리 준비해둔 적이 없다(`principles.md`의 "두 번째
   실험이 실제로 시작될 때 공통점을 추출한다" — s3-forge를 기각했던 것과 같은 이유).
2. forge 소스는 별도 레포에 있어서 이 세션이 직접 못 고친다 — 지금 forge부터 가면 제안서
   작성 → 사용자가 별도 forge 레포에서 구현/배포 → 그 다음에야 이 실험 착수가 가능해져서,
   API 모양을 검증 없이 추측한 채로 착수 자체가 블로킹된다.

(사용자와 대화로 확정한 결정 — 초안에서는 "가능하면 forge부터"도 검토했으나 위 이유로 로컬
우선으로 최종 확정)

## 현재 상태 (AS-IS)

신규 실험. 재사용 가능한 기존 코드 없음. node-forge의 `database`/`response`/`logger`/
`metrics`/`health`는 order-outbox에서 이미 검증됐고, 이번엔 gRPC와 게이트웨이 인증/인가가
새로 필요하다 — 위 결정에 따라 둘 다 이 실험 로컬 코드로 시작.

## 변경 후 상태 (TO-BE)

```
Browser → gateway(REST, 인증/인가/라우팅, panel.html 서빙)
            └─ gRPC → orchestrator(saga 상태기계 + 영속화)
                         ├─ gRPC → order-service (Try/Confirm/Cancel)
                         └─ gRPC → inventory-service ×2 인스턴스 (Try/Confirm/Cancel)
```

- **gateway**(3300) — HMAC 기반 lab 토큰으로 인증, role(customer/admin)로 인가. 비즈니스
  로직 없이 orchestrator에 gRPC로만 위임. panel.html 서빙(유일한 REST 진입점).
- **orchestrator**(3301) — `POST 체크아웃` 요청을 받아 saga 인스턴스를 자기 DB(`saga_db`)에
  먼저 기록(orchestrator 자신의 durable-state 원칙 — order-outbox에서 검증한 "커밋 전
  영속화" 패턴을 saga 단위로 확장) 후 비동기로 진행. order-service/inventory-service에 Try를
  gRPC로 순차 호출, 전부 성공 시 Confirm, 하나라도 실패 시 이미 성공한 단계들에 대해
  Cancel(보상)을 호출. 진행 상태는 폴링으로 조회(`GET /checkout/:sagaId`, 기존 세 실험의
  "폴링 유지, 데이터만 풍부하게" 컨벤션을 그대로 따름).
- **order-service**(3302) — 주문 생성 Try(pending 행 생성)/Confirm(확정)/Cancel(취소)를 gRPC로
  노출. 자기 DB(`order_db`).
- **inventory-service**(내부 전용, 호스트 포트 미노출, 2인스턴스로 스케일) — 재고 예약
  Try(조건부 UPDATE로 원자적 예약)/Confirm(차감 확정)/Cancel(예약 해제)을 gRPC로 노출. 자기
  DB(`inventory_db`). **다중 인스턴스 정합성 검증 대상** — 두 인스턴스 중 어디로 요청이
  가든 DB 행 잠금이 정합성을 보장하는지 실측.

## 변경 범위

| 파일/디렉토리 | 변경 내용 |
|---|---|
| `services/msa-checkout/package.json` 등 스캐폴딩 | NestJS 10.4 + `@nestjs/microservices` + `@grpc/grpc-js` + `@grpc/proto-loader` + TypeORM + node-forge 1.0.4 신규 워크스페이스 패키지 |
| `proto/order.proto`, `proto/inventory.proto` | gRPC 서비스 계약 (TryX/ConfirmX/CancelX) |
| `src/gateway/*` | REST 컨트롤러, HMAC 인증 가드, role 기반 인가 가드, orchestrator gRPC 클라이언트 — 전부 로컬 구현 |
| `src/orchestrator/*` | saga 엔티티(TypeORM, `saga_instances`/`saga_steps`), 상태기계 서비스, order/inventory gRPC 클라이언트, orchestrator 자신의 gRPC 서버(gateway가 호출) |
| `src/order-service/*`, `src/inventory-service/*` | 각자 엔티티 + gRPC 컨트롤러(Try/Confirm/Cancel) |
| `docker-compose.yml` | gateway/orchestrator/order-service/inventory-service(scale 2)/postgres, 단일 이미지 + `command:` 분기(기존 컨벤션) |
| `public/panel.html` | 체크아웃 시작, saga 진행 상태(단계별 성공/실패/보상) 폴링 표시, "재고 소진 상황에서 동시 체크아웃 2건" 유발 버튼(다중 인스턴스 검증용) |
| `ARCHITECTURE.md`, `docs/architecture.md` | 신규 실험 문서화, 4번째 노드 추가 |

## 영향성

| 영향 대상 | 영향 내용 |
|---|---|
| waiting-room / live-ranking / order-outbox | 변경 없음 (완전히 독립된 신규 워크스페이스) |
| node-forge / kafka-forge | 이번 라운드에서는 수정 없음. gRPC/HMAC 인증이 검증되면 그 설계를 근거로 후속 제안서 작성 예정(이번 작업 범위 밖) |
| dashboard | `forge-lab.json`의 `panelUrl`만 추가되면 자동으로 4번째 탭 노출 (dashboard 코드 변경 없음, 기존 컨벤션 그대로) |

## Breaking Changes

없음 (신규 독립 실험).

## 위험도

**HIGH** — 이 랩에서 처음 다루는 통신 방식(gRPC)과 처음 다루는 패턴(saga 상태기계 + 보상
트랜잭션)이 동시에 들어가고, 프로세스 수도 이전 최대(2개)의 2배(4개, 그중 하나는 2인스턴스).
다중 인스턴스 gRPC 클라이언트 로드밸런싱(Docker DNS round-robin 설정)이 새로 마주치는
기술적 난관으로 예상됨.

## 주의사항

- gRPC 클라이언트(orchestrator → inventory-service)는 기본 설정으로는 첫 연결의 인스턴스에
  고정될 수 있어(`grpc-js` 기본은 `pick_first`), 명시적으로 `dns` resolver +
  `round_robin` loadBalancingConfig를 설정해야 실제로 두 인스턴스에 분산된다 — 다중 인스턴스
  검증의 전제 조건이므로 반드시 확인.
- inventory Try는 반드시 원자적 조건부 UPDATE(`WHERE available - reserved >= qty`)로 구현.
  `SELECT` 후 애플리케이션에서 조건 검사 후 `UPDATE`하는 2단계 방식은 TOCTOU 교훈을 반복하는
  것이므로 금지.
- orchestrator가 각 단계 결과를 실제로 영속화한 "다음"에만 다음 단계로 진행 — 진행 중 죽어도
  재기동 후 마지막 영속화 지점부터 재개/보상 가능해야 함 (검증 항목에 포함).

## 작업 단계

### 1단계: 스캐폴딩 + proto 계약

1. `services/msa-checkout` 워크스페이스 생성 (package.json/tsconfig/.npmrc/.env/vitest.config.ts)
2. `proto/order.proto`, `proto/inventory.proto` 작성

### 2단계: 도메인 서비스 (order-service, inventory-service)

1. TypeORM 엔티티 + gRPC 컨트롤러(Try/Confirm/Cancel) 구현
2. inventory Try의 원자적 조건부 UPDATE 구현 + vitest(SQLite in-memory, order-outbox 패턴 재사용)

### 3단계: orchestrator

1. saga 엔티티(인스턴스/스텝) + 상태기계 서비스
2. order/inventory gRPC 클라이언트, 실패 시 보상(Cancel) 로직
3. vitest로 상태기계 단위 테스트(전체 성공/중간 실패 시 보상 경로)

### 4단계: gateway

1. HMAC 인증 가드 + role 기반 인가 가드
2. orchestrator gRPC 클라이언트, REST 라우팅
3. panel.html

### 5단계: 통합 + 다중 인스턴스 검증

1. docker-compose (inventory-service `deploy.replicas: 2` 또는 `--scale`)
2. gRPC round-robin 설정 확인
3. 실제 컨테이너로 재현: 재고 1개 상황에서 동시 체크아웃 2건 → 정확히 1건만 성공 확인
4. orchestrator 강제 종료 후 재기동 → 진행 중이던 saga가 유실 없이 이어지는지 확인

## 검증 방법

- vitest 전체 통과
- `docker compose up --build -d` 정상 기동, 4개 프로세스 + postgres 헬스체크 통과
- 정상 체크아웃 1건이 Try→Confirm까지 전 단계 정상 진행되는 것을 패널/폴링으로 확인
- 재고 부족 시 order-service Confirm 이후 inventory Try 실패 → order-service에 Cancel이
  호출되어 보상되는 것을 실제로 재현(재고 없는 상품으로 체크아웃)
- **다중 인스턴스**: 재고 1개 상황에서 동시 요청 2건 → 정확히 1건 성공, 나머지는 재고부족
  응답 (양쪽 inventory-service 인스턴스 로그로 실제로 요청이 분산됐는지도 확인)
- orchestrator 재기동 후 saga 재개/보상 확인

## 참조 규칙

- `rules/common/principles.md` — gRPC/HMAC 인증을 forge로 바로 올리지 않고 로컬 구현 후
  검증하는 근거(두 번째 필요 사례가 생길 때 추출)
- `rules/project/convention.md` — 대시보드는 `forge-lab.json`의 `panelUrl`만으로 자동 노출
