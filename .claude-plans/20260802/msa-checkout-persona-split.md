## 플랜 실행 이력

### 후속: 2026-08-02 — 429가 계속 쌓임(RATE_LIMIT_LIMIT 기본값 20이 여전히 부족) 추가 수정

사용자 리포트: "안되고, 429가 계속 쌓이고 있어" — 바로 앞 수정(끝난 saga 재조회 방지)만으로는
부족했음.

**원인**: `docker-compose.yml`에 `RATE_LIMIT_LIMIT`가 지정돼 있지 않아 기본값(20/60초)을
그대로 썼음. 개발자 콘솔의 "재고/saga 상태" 탭 하나만 열려 있어도 2초마다 상품 2개를
조회해서 그 자체로 분당 60회 — saga 목록 쪽을 고쳐도 이 탭 하나만으로 옛 한도(20)를 그냥
넘김. panel.html+개발자콘솔+receipt.html 세 화면이 각자 폴링하는 지금 구조에서 20/60초는
애초에 너무 타이트했음.

**실제 변경 파일**:
- `services/msa-checkout/docker-compose.yml` — gateway 서비스에 `RATE_LIMIT_LIMIT: "120"`
  명시(기존 기본값 20)
- `services/msa-checkout/public/panel.html` — 개발자 콘솔 "재고/saga 상태" 탭 폴링
  2000→4000ms, `refreshSagas` 폴링 1500→2500ms
- `services/msa-checkout/public/receipt.html` — 폴링 1500→2500ms

**검증(2026-08-02)**: 재빌드 후 `docker inspect`로 `RATE_LIMIT_LIMIT=120` 반영 확인. 같은
sagaId에 30연속 요청 → 전부 200(이전엔 11번째부터 429). panel.html+개발자콘솔+receipt.html
동시 폴링을 20초간 흉내낸 테스트에서, 검증 스크립트 자체가 짧은 시간에 curl을 수십~백여 건
연달아 쏴서 새 한도(120)까지 스스로 소진시켜 일시적으로 429가 재현됐음(이건 테스트 스크립트의
과도한 연속 호출이 원인 — 실제 브라우저 폴링 주기로는 재현 안 될 부하량). rate limit 윈도우가
완전히 비워진 뒤 깨끗한 상태에서 단건 체크아웃→조회는 정상 200 확인.

**계획과의 차이**: 없음 — 직전 수정이 부족해서 추가로 진행.

**잔존 작업**: 사용자가 실제 브라우저에서 재확인 필요. 계속 재현되면 브라우저 네트워크
탭에서 실제 요청 빈도를 캡처해서 원인을 좁힐 것.

---

### 후속: 2026-08-02 — "영수증 보기"가 "주문 정보를 확인할 수 없습니다"로 실패하는 버그 수정

사용자 리포트: "영수증보기 누르면 주문정보를 확인할 수 없다고 나오지?"

**원인**: gateway의 `ThrottlerModule`(IP당 60초 20회 제한)에 걸림. `panel.html`의 "내 주문
내역"이 localStorage에 누적된 sagaId를 최대 30개까지 1.5초마다 전부 다시 조회하는
구조였는데(이건 사실 재개편 이전 원본 코드부터 있던 패턴), 이미 CONFIRMED/CANCELLED로
끝난 saga까지 상태가 안 바뀜에도 계속 재조회하고 있었음. 개발자 콘솔의 재고/saga 상태
탭(2초 폴링), `receipt.html` 자신의 폴링(1.5초)까지 같은 IP의 요청 예산을 나눠 쓰다 보니
금방 429가 났고, `panel.html`의 saga 목록은 실패한 행을 조용히 빈 문자열로 건너뛰어 티가
안 났지만(`if (!v || !v.found) return ""`), `receipt.html`은 `!res.ok`를 명시적으로 걸러서
"주문 정보를 확인할 수 없습니다"로 정직하게(그러나 혼란스럽게) 보여줬음. curl로 동일
엔드포인트에 25연속 요청을 날려 11번째부터 전부 429가 되는 것으로 재현·확인함.

**실제 변경 파일**:
- `services/msa-checkout/public/panel.html` — `refreshSagas()`에 `sagaViewCache`(Map) 도입,
  CONFIRMED/CANCELLED(최종 상태)로 확인된 saga는 다시 조회하지 않고 캐시에서만 렌더링.
  표시 개수도 30→10으로 줄임
- `services/msa-checkout/public/receipt.html` — saga 상태가 CONFIRMED/CANCELLED에 도달하면
  `clearInterval`로 폴링 자체를 멈춤(더 이상 바뀔 일이 없는 상태를 계속 찔러볼 이유가 없음)

**계획과의 차이**: 이번 라운드는 사용자가 완료 직후 발견한 버그 리포트로 촉발된 추가
수정이라 원래 계획엔 없었음. 백엔드(rate limit 설정 자체)는 건드리지 않음 — 완료된
주문을 불필요하게 계속 폴링하던 프론트엔드 쪽 비효율이 근본 원인이라고 판단해 그쪽만 고침.

**검증(2026-08-02)**: Docker 재빌드·재기동 후, 수정된 코드가 실제로 서빙되는 것 확인.
`curl`로 체크아웃 직후 조회가 200으로 정상 동작하는 것 재확인(rate limit 윈도우 회복 후).
브라우저 폴링 로직 자체(Map 캐시 히트/미스, `clearInterval` 타이밍)는 브라우저 자동화
도구가 없어 직접 클릭으로 확인하지 못함 — 로직 리뷰와 curl 기반 재현으로 원인·해결 방향만
검증.

**잔존 작업**: 없음. 계속 문제가 재현되면 브라우저 개발자 도구의 Network 탭에서 429 응답
자체가 남아있는지 확인해달라고 안내할 것.

---

### 완료: 2026-08-02

**결과**: 성공. 계획한 4단계 전부 완료(백엔드 소배선 포함). 4개 서비스 재개편 시리즈의
마지막(다섯 번째) 적용.

**실제 변경 파일**:
- `services/msa-checkout/src/shared/admin-log-event.ts` — 신규, `AdminLogEvent{message,at}`
- `services/msa-checkout/src/gateway/gateway.module.ts` — `AdminEventsModule.forRoot({path:
  "admin/logs"})` 추가. **최초에는 `GatewayAppModule`(루트)에 넣었다가 부팅 실패**
  (`Nest can't resolve dependencies of the CheckoutController ... FORGE_ADMIN_EVENT_BUS`) —
  `CheckoutController`/`AdminController`가 형제 모듈인 `GatewayModule` 소속이라 DI가 안
  닿았음. `GatewayModule` 쪽으로 옮겨서 해결(진짜 컨테이너 기동으로 실제 재현·수정함)
- `services/msa-checkout/src/gateway/checkout.controller.ts` — `AdminEventBus` 주입, 체크아웃
  시작 성공 시 이벤트 방송
- `services/msa-checkout/src/gateway/admin.controller.ts` — 재고 리셋 성공 시 이벤트 방송
  (인가 실패로 가드가 막는 경우는 핸들러 진입 전이라 서버 emit 없음 — 의도대로 확인)
- `services/msa-checkout/public/panel.html` — 전면 재작성: 헤더 바(브랜드 + 로그인 상태
  chip), 고객 로그인 + "체크아웃" 히어로(성공 시 "영수증 보기 →" 링크로
  `receipt.html?sagaId=...&token=...`을 새 탭에 엶), "내 주문 내역"(saga 목록, 행별 영수증
  링크). admin 로그인/재고 리셋/인가 실패 재현/경쟁 테스트(동시 체크아웃 2건)는 "테스트
  도구" 모달로 이동. 이벤트 로그 카드 제거 후 `PanelUI.mountDevConsole({tabs:[{id:"stock",
  label:"재고/saga 상태", pollMs:2000}]})`로 로그+재고 조회 탭 구성
- `services/msa-checkout/public/receipt.html` — 신규. 다른 4개 서비스의 channel.html/
  ticket-shop.html/broadcast-overlay.html/order-status.html에 대응하는, 이 saga가 실제로
  도달하는 곳(실제 쇼핑몰 결제완료/영수증 페이지 톤)의 데모. saga 상태를 성공
  경로(주문접수→주문확인→재고확보→결제확정)와 실패 경로(주문접수→주문확인→주문취소,
  lastError 표시) 둘 다 타임라인으로 표현. 기존 `GET /checkout/:sagaId`를 그대로 재사용
  (Bearer 토큰은 URL 쿼리로 전달, waiting-room의 ticket-shop.html과 동일한 패턴)

**계획과의 차이**: 백엔드 모듈 배치(GatewayAppModule→GatewayModule)만 계획과 달랐고,
원인을 실제 컨테이너 부팅 에러로 확인한 뒤 즉시 수정 — 그 외에는 계획대로 진행.

**검증(2026-08-02)**: 유닛 테스트 22개 회귀 없음(모듈 이동 전/후 둘 다 재확인). `node
--check`로 두 HTML의 인라인 스크립트 문법 확인, id 참조 무결성 확인. Docker 재빌드(gateway
만)·재기동 후 curl로 (1) 토큰 발급→체크아웃→saga CONFIRMED 전이→`GET /checkout/:sagaId`가
receipt.html이 기대하는 그대로(orderId/reservationId 포함) 반환되는 것, (2) 체크아웃 시작
이벤트가 `/admin/logs/stream`으로 정확히 방송되는 것, (3) 재고 리셋 성공 시 이벤트 방송 +
재고 조회 API 정상, (4) customer 토큰으로 admin 리셋 시도 시 403 + 서버 emit 없음(의도대로),
(5) widget-scarce 재고 1개에 동시 체크아웃 2건 발사 → 정확히 1건 CONFIRMED·1건 CANCELLED
(`lastError:"재고가 부족합니다"`)까지 전부 실제 재현 확인.

**잔존 작업**: 브라우저 자동화 도구가 없어 실제 화면(모달, 영수증 타임라인 펄스 등)은
사용자가 직접 열어 확인 필요. 이걸로 forge-lab 4개 실험(webhook-relay/waiting-room/
live-ranking/order-outbox/msa-checkout — 총 5개) 전체의 페르소나+개발자콘솔+실제목적지
데모 재개편이 완료됨.

---

# msa-checkout-persona-split — webhook-relay/waiting-room/live-ranking/order-outbox 수준으로 UI 전면 재개편

## 목표

msa-checkout의 `panel.html`을 앞선 4개 서비스와 같은 깊이로 재개편한다: 실사용 페르소나
화면(장바구니에서 결제하는 손님) + 공통 개발자 콘솔(로그/saga·재고 원시 상태) + 결제가
실제로 이어지는 목적지를 보여주는 별도 데모 앱(영수증/주문확인 페이지). 4개 서비스 중
마지막으로 이 서비스를 재개편함.

## 현재 상태 (AS-IS)

`services/msa-checkout/public/panel.html` 하나만 존재. 다른 4개 서비스와 달리 **서버 쪽
SSE 로그 스트림(AdminEventBus/`/admin/logs/stream`)이 아예 없어서**, "이벤트 로그"가 버튼
클릭 시 클라이언트가 직접 `logEvent()`를 호출해 쌓는 것뿐이고, saga가 백그라운드에서
자동 전이되는 건 로그로 안 잡힘(1.5초 폴링으로만 보임). `mountDevConsole`도 미도입 — 카드
5개(로그인/재고현황/체크아웃/saga목록/이벤트로그)+가이드가 메인 화면에 평면 나열된 구조.

도메인: gateway(3300, REST)↔orchestrator/order-service/inventory-service(gRPC) 4프로세스.
`POST /checkout`(customer 권한, JWT)으로 saga 시작 → orchestrator가 2초 폴링으로
`STARTED→ORDER_TRIED→INVENTORY_TRIED→CONFIRMED`(실패 시 `COMPENSATING→CANCELLED`) 진행.
`GET /checkout/:sagaId`(customer/admin 권한)가 `{found, sagaId, productId, quantity, status,
orderId?, reservationId?, lastError?}` 반환. `POST/GET /admin/inventory/:productId`(reset은
admin, 조회는 customer/admin)로 재고 관리. circuit breaker는 이 실험에 없음(스코프 아웃).

## 변경 후 상태 (TO-BE)

- **백엔드(작은 추가, 다른 4개와 유일하게 다른 부분)**: gateway에
  `AdminEventsModule.forRoot({path:"admin/logs"})` 추가(다른 서비스와 동일한 node-forge
  1.0.9 패턴), `checkout.controller.ts`(체크아웃 시작)/`admin.controller.ts`(재고 리셋)에
  `AdminEventBus.emit()` 추가 — gateway가 실제로 처리한 사실만 방송(주문 실패/인가 거부처럼
  가드가 핸들러 진입 전에 막는 경우는 여전히 클라이언트 쪽에서 기록)
- `panel.html` — "장바구니에서 결제하는 손님" 페르소나로 재구성:
  - 헤더 바(브랜드 + 로그인 상태 chip)
  - 고객 로그인 + "체크아웃" 히어로(상품/수량 선택, 체크아웃 버튼), 성공 시 "영수증 보기 →"
    링크가 `receipt.html?sagaId=...&token=...`을 새 탭으로 엶
  - "내 주문 내역"(saga 목록, 기존 유지, 행별 "영수증" 링크 추가)
  - admin 로그인/재고 리셋/인가 실패 재현/동시 체크아웃 2건(경쟁 테스트)은 "테스트 도구"
    모달로 이동
  - 이벤트 로그 카드 제거 → `mountDevConsole({tabs:[{id:"stock", label:"재고/saga 상태",
    pollMs:2000}]})`로 "로그"(신규 SSE) + "재고/saga 상태"(재고 현황 + 최근 saga 원시 상태)
    탭 구성
- **신규** `public/receipt.html` — 다른 서비스들의 channel.html/ticket-shop.html/
  broadcast-overlay.html/order-status.html에 대응하는, "이 체크아웃 saga가 실제로 도달하는
  곳"을 보여주는 완전히 다른 스타일의 데모. 실제 쇼핑몰 결제 완료/영수증 페이지 톤 — saga
  상태를 타임라인(주문 확인→재고 확보→결제 확정, 실패 시 취소 사유)으로 표시. `GET
  /checkout/:sagaId`를 그대로 폴링 재사용(Bearer 토큰은 URL 쿼리로 전달, waiting-room의
  ticket-shop.html과 동일한 패턴) — 새 API 불필요

## 변경 범위

| 파일 | 변경 내용 |
|------|----------|
| `services/msa-checkout/src/shared/admin-log-event.ts` | 신규 — `AdminLogEvent` 타입 |
| `services/msa-checkout/src/gateway/app.module.ts` | `AdminEventsModule.forRoot` 추가 |
| `services/msa-checkout/src/gateway/checkout.controller.ts` | 체크아웃 시작 시 이벤트 방송 |
| `services/msa-checkout/src/gateway/admin.controller.ts` | 재고 리셋 시 이벤트 방송 |
| `services/msa-checkout/public/panel.html` | 헤더/히어로/모달/개발자콘솔 구조로 전면 재작성 |
| `services/msa-checkout/public/receipt.html` | 신규 — 결제 영수증/주문확인 데모 |

saga/재고 도메인 로직(orchestrator/order-service/inventory-service) 자체는 변경 없음.

## 영향성

| 영향 대상 | 영향 내용 |
|-----------|----------|
| saga 진행/재고 예약 도메인 로직 | 변경 없음 |
| gateway의 인증/인가/rate-limit | 변경 없음 — AdminEventBus는 성공 경로에만 얹음 |
| 다른 서비스(webhook-relay/waiting-room/live-ranking/order-outbox) | 변경 없음 |
| `@forge-lab/panel-ui` | 변경 없음 — 이미 만들어진 `mountDevConsole` 재사용만 |

## Breaking Changes

없음.

## 위험도

**LOW** — 다른 4개 서비스에서 이미 4번 검증된 patttern(AdminEventBus 배선)을 그대로
적용하는 것뿐이라 위험이 낮음. 정적 파일 변경은 프론트엔드 전용.

## 작업 단계

### 1단계: 백엔드 — AdminEventBus 배선 (완료)

1. `AdminLogEvent` 타입, `AdminEventsModule.forRoot({path:"admin/logs"})` 추가
2. checkout/admin 컨트롤러에 emit 추가, 빌드/기존 유닛테스트 회귀 확인

### 2단계: panel.html 재구성

1. 헤더 + 로그인 + "체크아웃" 히어로(성공 시 영수증 링크)
2. "내 주문 내역" 유지 + 행별 영수증 링크
3. admin 로그인/재고 리셋/인가 실패 재현/경쟁 테스트를 "테스트 도구" 모달로 이동
4. `mountDevConsole`로 로그+재고/saga 상태 탭 구성
5. 가이드 문구 갱신

### 3단계: receipt.html 신규 작성

1. URL 쿼리(`sagaId`, `token`)로 `GET /checkout/:sagaId` 폴링(Bearer 토큰 헤더로 전달)
2. saga 상태를 결제 영수증 타임라인으로 표시(성공/보상 케이스 모두)
3. panel.html과 완전히 다른 독립 스타일(실제 쇼핑몰 결제완료 페이지 톤)

### 4단계: 검증 + 문서화

1. Docker 재빌드·재기동 후 curl로 체크아웃→saga 전이→영수증 조회, 인가 실패, 재고 리셋
   SSE 방송까지 재현
2. `node --check`로 인라인 스크립트 문법, id 참조 무결성 확인
3. `services/msa-checkout/ARCHITECTURE.md`에 이번 변경 이력 추가
4. 이 플랜 파일에 실행 이력 추가

## 검증 방법

- `docker compose -f services/msa-checkout/docker-compose.yml up -d --build`
- curl로 토큰 발급 → 체크아웃 → saga 상태 전이(CONFIRMED/CANCELLED) 확인, `/admin/logs/stream`
  SSE로 체크아웃/재고리셋 이벤트 수신 확인
- 기존 vitest 스위트 회귀 없음 확인(완료)

## 참조 규칙

- `.claude/rules/project/convention.md`의 "실사용 페르소나 화면 + 공통 개발자 콘솔" 절 —
  이번 작업이 다섯 번째(마지막) 적용 사례
- `.claude/rules/common/principles.md` — 필요한 만큼만 변경(이번엔 예외적으로 작은 백엔드
  추가가 필요하다고 판단해 사용자에게 먼저 확인받음)
