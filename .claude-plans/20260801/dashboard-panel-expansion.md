## 플랜 실행 이력

### 후속: 2026-08-01 — SSE 로그 스트리밍을 waiting-room/live-ranking으로 확산, msa-checkout은 제외

node-forge 1.0.9 공식 API로 SSE를 나머지 서비스에 확산:

- **waiting-room**: `WaitingRoomService.register()`(등록)/`AdmissionService.runAdmission()`(입장
  허용)에 `AdminEventBus` 주입, `/admin/logs/stream`으로 방송. panel.html의 "admission 감지 추정"
  휴리스틱과 등록 성공 낙관적 로그 제거. 실제 등록→입장 2개 이벤트 실시간 수신 확인, 유닛
  테스트 20개 통과
- **live-ranking**: `RankingService.applyDelta()`(점수 반영)/`DlqLogService.record()`(DLQ
  이동)에 `AdminEventBus` 주입, aggregator의 `/admin/logs/stream`으로 방송(ingest는 제외 — 이벤트
  제출 자체가 이미 HTTP 응답으로 동기 확인됨). panel.html의 점수 비교 휴리스틱 제거. 실제
  반영/DLQ 이벤트 실시간 수신 확인, 유닛 테스트 27개 통과
- **msa-checkout은 SSE 확산 대상에서 제외** — saga 전이가 orchestrator(호스트 포트 없음, "포트
  은닉"이 의도적 설계 결정)에서 일어나서, SSE로 보여주려면 (a) gRPC 스트리밍을 새로 만들거나
  (b) 포트 은닉 원칙을 이 케이스만 예외로 두거나 둘 중 하나가 필요한데, 이미 패널 폴링(1.5초)이
  실제 saga 상태를 그대로 읽어와 지연이 크지 않아 비용 대비 이득이 낮다고 판단 — 사용자에게
  세 가지 선택지를 제시했고, "이걸 할 의미가 있나?"는 반문으로 스킵 확정. 대신 5단계(saga/gRPC
  trace 조회 뷰)가 msa-checkout에 실제로 필요한 관측성 개선이라고 정리

**결과**: 4개 실험 중 3개(order-outbox/waiting-room/live-ranking)에 SSE 로그 스트리밍 적용
완료. msa-checkout은 의도적으로 제외. 이걸로 1~3단계(공유 패널 UI/admin API 네이밍/SSE) 전부
마무리.

### 후속: 2026-08-01 — node-forge 1.0.9 채택(공식 AdminEventBus/AdminEventsModule로 교체)

같은 날 작성한 `20260801-admin-event-sse-stream.md` 제안서가 node-forge 1.0.9로 반영됨
(`events`/`events/nestjs` 모듈, `AdminEventBus<T>` + `AdminEventsModule.forRoot({ path })`).

- order-outbox의 로컬 `admin-events.service.ts`/`admin-logs.controller.ts` 삭제, 공식 API로 교체
- `emit()` 시그니처 차이(`(type, message)` 2인자 → `emit(event: T)` 1개 객체)에 맞춰
  `orders.service.ts`/`outbox-publisher.service.ts`/`order-created.consumer.ts`/테스트 파일 수정
- `OrdersModule`/`FulfillmentModule`이 각자 `AdminEventsModule.forRoot({ path: "admin/logs" })`를 import
- Docker 재빌드 후 실제 주문 1건으로 재검증: `created`(api) → `published`(api) →
  `confirmed`(fulfillment, cross-origin) 3개 이벤트가 순서대로 정상 수신. 유닛 테스트 19개
  전부 통과. `ARCHITECTURE.md`/`docs/issues.md`(1.0.9 행 추가)에 반영
- 나머지 3개 서비스로의 SSE 확산은 이 공식 API가 확정됐으니 이제 진행 가능 — 아직 미착수

### 완료: 2026-08-01 — 1~3단계(서비스별 개별 갭인 4단계 제외)

**결과**: 성공. 1~3단계 전부 Docker로 실제 재현·검증 완료. 4단계(서비스별 개별 갭)는
사용자 요청대로 이번 라운드에서 제외 — "서비스별 디테일한 부분은 구현된 걸 보고 다시
요청" 하기로 함.

**실제 변경 파일**:
- `services/shared-panel-ui/`(신규) — `package.json`(`@forge-lab/panel-ui`, private, 빌드
  단계 없이 `dist/`를 소스로 직접 관리), `dist/panel-ui.css`(카드/버튼/폼/로그/가이드 공통
  스타일 + 다크모드 CSS 변수), `dist/panel-ui.js`(`createLogger`, `connectSSE` 유틸)
- 4개 서비스 `package.json` — `@forge-lab/panel-ui` 의존성 추가
- 4개 서비스 `main.ts`(gateway 포함) — `require.resolve("@forge-lab/panel-ui/package.json")`로
  실제 위치를 찾아 `/shared/*`로 추가 마운트
- 4개 서비스 `public/panel.html` — 공통 CSS를 `<link rel="stylesheet" href="/shared/panel-ui.css">`로
  교체, 중복 `logEvent` 구현을 `PanelUI.createLogger`로 교체, 서비스 고유 스타일만 로컬에 남김
- **4개 서비스 `docker-compose.yml` + `Dockerfile` 전면 재작성**(계획에 없었던 추가 작업,
  아래 "계획과의 차이" 참고) — 빌드 컨텍스트를 서비스 디렉토리(`context: .`)에서 레포
  루트(`context: ../..`, `dockerfile: services/<name>/Dockerfile`)로 변경
- `/.dockerignore`(신규) — 컨텍스트가 레포 루트로 커지면서 전송 용량을 줄이기 위함.
  `dist/`를 통째로 제외하면 `shared-panel-ui/dist`(빌드 산출물이 아니라 커밋된 소스)까지
  같이 빠지는 버그를 겪고 나서 그 줄을 뺐다(주석으로 이유 명시)
- `.claude/rules/project/convention.md` — "패널 공유 UI" 섹션, "Admin/Test API 네이밍" 섹션 추가
- `services/waiting-room/src/waiting-room/admin.controller.ts`(신규) — `reset`/`removeUsers`를
  `WaitingRoomController`에서 분리해 `/admin/rooms/:roomId/waiting-users`로 이동
  (`waiting-room.controller.ts`, `waiting-room.module.ts`, `public/panel.html` 동반 수정)
- `services/live-ranking/src/aggregator/dlq.controller.ts` — `/dlq` → `/admin/dlq`
  (`public/panel.html` fetch 경로 동반 수정)
- `services/order-outbox/src/api/outbox.controller.ts` — `/outbox` → `/admin/outbox`
  (`public/panel.html` fetch 경로 동반 수정)
- msa-checkout은 이미 `/admin/inventory/...`를 쓰고 있어서 변경 없음(이 패턴의 원형)
- `services/order-outbox/src/shared/admin-events.service.ts`(신규) — 프로세스 로컬 rxjs
  `Subject` 기반 이벤트 브로드캐스터
- `services/order-outbox/src/shared/admin-logs.controller.ts`(신규) — `@Sse("stream")`으로
  `/admin/logs/stream` 노출, api/fulfillment 양쪽 모듈이 그대로 재사용
- `services/order-outbox/src/api/orders.service.ts` — 주문 생성 성공 시 `"created"` 이벤트 발행
- `services/order-outbox/src/api/outbox-publisher.service.ts` — 발행 성공 시 `"published"` 이벤트 발행
- `services/order-outbox/src/fulfillment/order-created.consumer.ts` — UPDATE `affected`가 있을
  때만(재배달로 인한 no-op 제외) `"confirmed"` 이벤트 발행
- `services/order-outbox/src/fulfillment/main.ts` — `app.enableCors()` 추가(패널은 api가
  서빙하지만 confirmed 이벤트는 fulfillment 자기 포트에서 나와 cross-origin)
- `services/order-outbox/public/panel.html` — SSE로 api(`/admin/logs/stream`)와
  fulfillment(`http://localhost:3201/admin/logs/stream`) 양쪽을 구독하도록 추가, 기존
  폴링 기반 전이 감지(`loggedTransitions`)와 클라이언트 낙관적 생성 로그를 제거(SSE가
  더 정확한 서버 진실을 실시간으로 제공하므로 중복 로그 방지)

**계획과의 차이**:
- **Docker 빌드 컨텍스트 재구성은 원래 계획에 없었다** — `@forge-lab/panel-ui`를 Docker
  빌드에서 심볼릭 링크로 해석하려면 워크스페이스 루트 `package.json`이 빌드 컨텍스트 안에
  있어야 한다는 걸 waiting-room 파일럿 도중 실제로 겪고서야 알았다. 레포 전체 빌드 구조에
  영향이 가는 구조적 결정이라 작업을 멈추고 사용자에게 두 가지 대안(컨텍스트를 레포 루트로
  바꾸기 vs npm 의존성을 포기하고 정적 파일만 이미지에 박아넣기)을 제시해 확인받은 뒤 진행함.
  `.npmrc`가 워크스페이스 멤버 디렉토리에서 무시된다는 npm의 동작(`npm warn config ignoring
  workspace config`)도 이 과정에서 처음 발견해서 워크스페이스 루트(`/app/.npmrc`)로 옮겼다.
- 3단계(SSE)는 계획에 "order-outbox 파일럿, 검증되면 나머지 확산"이라고 적었는데, 실제로는
  api/fulfillment 두 프로세스 모두에 SSE를 구현했다 — "확인됨" 전이가 fulfillment(별도
  컨테이너)에서만 일어나는 걸 실제로 확인하고 나서, api만으로는 3단계 중 2단계밖에 못
  덮는다는 걸 깨닫고 스코프를 넓혔다. 다른 3개 서비스로의 확산과 node-forge 제안 여부는
  아직 안 함(아래 잔존 작업 참고).

**잔존 작업**:
- SSE 로그 스트리밍을 waiting-room/live-ranking/msa-checkout으로 확산 — **보류**. 사용자가
  "이건 node-forge에 제안서부터 써야 하는 거 아니야?"라고 지적해서(로컬 검증 후 제안 컨벤션을
  놓침), `proposals/node-forge/20260801/20260801-admin-event-sse-stream.md` 작성 완료.
  `@paikpaik/node-forge/events` + `events/nestjs`(`AdminEventBus` + `AdminEventsModule.forRoot()`)
  제안 — 나머지 3개 서비스 확산은 이 제안이 반영된 뒤, 공식 API로 진행 예정
- 4단계(서비스별 개별 실험/테스트 갭: waiting-room 다중 인스턴스 admission 테스트, live-ranking
  크래시 재현 트리거, order-outbox 데드레터 복구 UI+API, msa-checkout trace 조회 뷰) —
  사용자 요청대로 이번 라운드에서 의도적으로 제외

---

# dashboard-panel-expansion — 대시보드/패널 공통 UX 확장 + 서비스별 실험 UI 보강

## 목표

4개 실험(waiting-room, live-ranking, order-outbox, msa-checkout)의 패널 UI가 카드그리드/로그뷰/버튼
스타일을 매번 복붙하고 있는 걸 공유 패키지로 정리하고, docker logs를 직접 안 봐도 패널에서 실시간
데이터 흐름을 확인할 수 있게 하며, 서비스마다 제각각인 admin/test API 네이밍을 통일한다. 여기에 더해
각 서비스가 이미 갖고 있던 실험/테스트 케이스 갭(다중 인스턴스 admission 테스트, 크래시 재현 트리거,
데드레터 복구 UI, saga trace 조회)을 보강한다.

## 현재 상태 (AS-IS)

- `dashboard/`: Fastify + vanilla JS, `dashboard/src/registry.ts`가 `services/*`를 스캔해 `docker-compose.yml`이
  있는 디렉토리만 서비스로 인정하고 `forge-lab.json`의 `panelUrl`을 iframe으로 띄움. Up/Down/Status만
  소유(컨벤션대로). 라이트 테마 고정, 미디어쿼리 없음.
- 4개 서비스의 `public/panel.html`이 각자 카드그리드/`.log`(이벤트 로그)/`.hint`/버튼 스타일을 인라인
  `<style>`로 복붙. 데이터 갱신은 전부 `setInterval` 폴링(1~3초), SSE/WS 없음.
- Admin/test API 네이밍이 서비스마다 제각각:
  - waiting-room: `DELETE /rooms/:roomId/waiting-users`(초기화), `POST .../remove`(다건 제거)
  - live-ranking: `GET/DELETE /dlq`
  - order-outbox: `GET /outbox/dead`
  - msa-checkout: `POST/GET /admin/inventory/:productId/reset`
- 서비스별로 이미 알려진 실험/테스트 갭(우선순위 정리 때 나온 것들):
  - waiting-room: 다중 인스턴스 admission-scheduler 동시 실행 테스트 없음
  - live-ranking: claim+effect 크래시 윈도우가 유닛테스트로만 검증, 실제 재현 트리거 없음
  - order-outbox: 데드레터 레코드 확인만 가능, 복구/재발행 수단 없음
  - msa-checkout: gRPC/saga trace를 패널에서 조회할 방법 없음(docker logs로만 확인)

## 변경 후 상태 (TO-BE)

- `services/shared-panel-ui/`(신규 워크스페이스 패키지) — 카드그리드/로그뷰/버튼/다크모드 CSS +
  폴링·SSE 연결 유틸 JS. `docker-compose.yml`이 없어서 대시보드 registry.ts가 자동으로 서비스 탭
  목록에서 제외함(별도 필터링 코드 불필요).
- 4개 서비스가 `node_modules/@forge-lab/panel-ui/dist`를 `app.useStaticAssets()`로 추가 마운트해서
  `panel.html`에서 `<link>`/`<script>`로 참조. 인라인 복붙 스타일 제거.
- 각 서비스에 SSE 기반 로그 스트리밍 엔드포인트 추가(우선 1개 서비스에서 로컬 구현·검증 후 나머지
  확산, 필요시 node-forge 제안).
- `rules/project/convention.md`에 admin/test API 네이밍 규칙 추가(`/admin/*` 프리픽스로 통일) + 4개
  서비스 라우트 리팩토링.
- 서비스별 개별 갭 4건 보강.

## 변경 범위

| 파일/디렉토리 | 변경 내용 |
|---|---|
| `services/shared-panel-ui/` (신규) | CSS(카드그리드/로그뷰/버튼/다크모드) + JS 유틸(폴링, SSE 연결, fetch 헬퍼) 패키지 |
| `services/*/src/main.ts` (4곳) | `useStaticAssets`에 shared-panel-ui dist 경로 추가 마운트 |
| `services/*/public/panel.html` (4곳) | 인라인 스타일 제거, 공유 에셋 참조로 교체 |
| `services/*/package.json` (4곳) | `@forge-lab/panel-ui` workspace 의존성 추가 |
| `rules/project/convention.md` | admin/test API 네이밍 규칙(`/admin/*` 프리픽스) 섹션 추가 |
| `services/*/src/**/*.controller.ts` (4곳) | 기존 admin/test 라우트를 `/admin/*`로 리팩토링 |
| 로그 스트리밍 대상 컨트롤러(1곳 우선) | SSE 엔드포인트 신규 추가, 검증 후 확산 |
| `proposals/node-forge/` (필요시) | 로그 스트리밍 관련 공통 헬퍼가 forge 후보로 판단되면 제안서 작성 |
| 서비스별 개별 파일(4곳, 아래 작업단계 4 참고) | 각 서비스 고유 갭 보강 |

## 영향성

| 영향 대상 | 영향 내용 |
|---|---|
| `dashboard/` 자체 | 변경 없음 — registry.ts가 `docker-compose.yml` 유무로 필터링하므로 shared-panel-ui가 서비스 탭으로 잘못 노출되지 않음 |
| 기존 패널 사용자(개발자 본인) | admin/test API 경로가 바뀌므로, panel.html의 fetch 호출부도 함께 수정 필요 — 패널과 API가 항상 쌍으로 움직이므로 실사용 영향 없음 |
| 각 서비스의 도메인 로직 | 변경 없음 — UI/관측/네이밍 레이어만 건드림 |
| node-forge | 로그 스트리밍 구현이 검증되고 범용성이 있다고 판단되면 제안 대상(사용자와 재확인 후 진행) |

## Breaking Changes

없음. 랩 내부 실험 코드라 외부 소비자가 없고, admin API 경로 변경은 패널 코드와 항상 같이 수정되므로
실사용 흐름이 끊기지 않음.

## 위험도

**MEDIUM** — 4개 서비스에 걸쳐 반복 작업이 필요해 범위는 넓지만, 서비스별로 독립적이라 하나씩 순서대로
적용·검증 가능. SSE 로그 스트리밍은 node-forge 로거와 맞물릴 수 있어 로컬 구현 전 설계를 먼저
검증해야 함(원칙 위반 방지).

## 주의사항

- `services/shared-panel-ui`는 `docker-compose.yml`을 만들지 않는다 — 만들면 대시보드가 서비스 탭으로
  오인식한다.
- 정적 에셋을 각 서비스 `public/`로 복사하는 방식(`copy:proto`류) 대신, `node_modules` 심볼릭 링크를
  통해 `useStaticAssets`로 직접 마운트한다 — 이전에 order-outbox/msa-checkout류에서 겪은 "빌드
  산출물 경로 불일치" 버그 패턴을 반복하지 않기 위함.
- SSE 로그 스트리밍은 raw docker stdout이 아니라 각 서비스의 구조화 로그(ForgeLoggerService 이벤트)
  기반으로 설계한다 — 이미 있는 pino 기반 로거를 우회하지 않고 그 위에 얹는다.
- admin API 리팩토링은 라우트 이름만 바꾸는 것이라 로직 위험은 낮지만, 4곳 다 빠짐없이 패널의 fetch
  호출부까지 같이 고쳐야 한다(둘 중 하나만 바꾸면 바로 깨짐).

## 작업 단계

### 1단계: 공유 패널 UI 패키지 신설

1. `services/shared-panel-ui/` 워크스페이스 패키지 생성(카드그리드/로그뷰/버튼/다크모드 CSS + 폴링·fetch
   유틸 JS, 빌드 산출물 `dist/`)
2. waiting-room 하나를 파일럿으로 선정해 `useStaticAssets` 추가 마운트 + `panel.html` 리팩토링, 실제
   브라우저로 렌더링 확인
3. 검증되면 나머지 3개 서비스(live-ranking, order-outbox, msa-checkout)에 동일 적용

### 2단계: Admin/Test API 네이밍 컨벤션 통일

1. `rules/project/convention.md`에 `/admin/*` 프리픽스 규칙 추가(예: `/admin/dlq`, `/admin/outbox/dead`,
   `/admin/inventory/:id/reset`, `/admin/waiting-room/reset`)
2. 4개 서비스 컨트롤러 라우트 리팩토링 + 각 panel.html의 fetch 경로 동시 수정
3. 서비스별로 실제 패널에서 버튼 눌러서 정상 동작하는지 재현 확인

### 3단계: 공통 SSE 로그 스트리밍 (로컬 구현 → 검증 → 필요시 forge 제안)

1. 파일럿 서비스 1곳(order-outbox 후보 — 이미 stage 배지/dead-letter 확인 UI가 있어 로그 스트리밍과
   맥락이 잘 맞음) 선정, `GET /admin/logs/stream` SSE 엔드포인트 로컬 구현
2. shared-panel-ui의 JS 유틸에 SSE 연결 헬퍼 추가, panel.html에 실시간 로그 뷰 반영
3. 실제로 이벤트 발생시켜서 패널에 실시간으로 찍히는지 확인
4. 검증되면 node-forge 제안 여부 사용자와 재확인 후, 나머지 3개 서비스로 확산

### 4단계: 서비스별 개별 실험/테스트 갭 보강

1. waiting-room: 다중 인스턴스 admission-scheduler 동시 실행 테스트(2+ 인스턴스 스케일 후 경쟁/중복
   여부 실제 재현) + 패널에 트리거 추가
2. live-ranking: claim+effect 크래시 윈도우 실제 재현용 트리거(패널 버튼 또는 admin API) 추가
3. order-outbox: 데드레터 레코드 복구/재발행 API + 패널 UI 추가
4. msa-checkout: saga/gRPC trace를 패널에서 조회하는 뷰 추가

## 검증 방법

- 각 단계마다 Docker/브라우저로 실제 재현(이 세션 원칙 — 이론이 아니라 실측)
- 1~2단계 완료 후: 4개 패널 전부 공유 에셋으로 렌더링되고, admin/test 버튼이 새 경로로 정상 동작하는지
  확인
- 3단계 완료 후: 실시간 로그가 실제 이벤트 발생과 동시에 패널에 반영되는지 확인
- 4단계 완료 후: 각 서비스의 기존 P0 갭이 실제로 재현 가능한 트리거로 닫혔는지 확인

## 참조 규칙

- `rules/common/principles.md` — 워크스페이스 경계(신규 공유 패키지)는 사용자 확인 후 진행(완료),
  forge 제안 필요 기능은 로컬 검증 후 제안서로
- `rules/project/convention.md` — 실험 간 코드 공유는 별도 공유 패키지 신설로(1단계), admin API
  네이밍 규칙 신설 대상(2단계)
- `rules/common/workflow.md` — 코딩 전 설계 확인(본 문서), forge 부족 기능 발견 시 제안서 우선(3단계)
