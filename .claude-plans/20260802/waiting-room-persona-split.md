## 플랜 실행 이력

### 완료: 2026-08-02

**결과**: 성공. 계획한 3단계 전부 완료.

**실제 변경 파일**:
- `services/waiting-room/public/panel.html` — 전면 재작성: 헤더 바(브랜드 + 대기 인원
  chip), "내 티켓" 히어로(점선 티켓 스텁 스타일, 상태별 큰 표시, 입장 가능 시 "입장하기 →"
  링크가 `ticket-shop.html?roomId=...&token=...`을 새 탭으로 염), 대기열 미리보기 그리드
  유지, 부하 시뮬레이션/초기화를 "테스트 도구" 모달로 이동, 이벤트 로그 카드 제거 후
  `PanelUI.mountDevConsole({tabs:[{id:"queue-state", label:"대기열 원시 상태", pollMs:2000}]})`
  로 로그+원시 대기열 목록 탭 구성
- `services/waiting-room/public/ticket-shop.html` — 신규. webhook-relay의 `channel.html`에
  대응하는, 이 대기열이 실제로 지키는 목적지를 보여주는 완전히 별도 스타일(실제 티켓
  판매 사이트 톤)의 데모 앱. URL의 `token`으로 `POST /rooms/:roomId/waiting-users/verify`
  호출 → 유효하면 좌석등급/매수 선택 + 5분 카운트다운(`ADMITTED_TOKEN_TTL_SECONDS` 근사)이
  있는 티켓 구매 화면, 무효면 "입장할 수 없습니다" + 대기열로 돌아가기 링크

백엔드(`src/**`) 변경 없음 — 계획대로 기존 도메인/관리 API(`register`/`getStatus`/`verify`/
`admin reset`/`admin remove`)를 그대로 재사용.

**계획과의 차이**: 없음.

**검증(2026-08-02)**: 기존 vitest 스위트(20개) 회귀 없음. `node --check`로 두 HTML의
인라인 스크립트 문법 확인, panel.html id 참조 무결성 확인. Docker 재빌드·재기동 후 curl로
전체 플로우 재현 — 등록 → 5초 뒤 admission으로 토큰 발급 확인 → 그 토큰으로 실제
`verify` 호출 시 `valid:true` 확인(ticket-shop.html의 정상 입장 경로), 조작된 토큰으로는
`valid:false` 확인(거부 경로). 테스트로 채운 대기열은 admin reset으로 정리.

**잔존 작업**: 브라우저 자동화 도구가 없어 실제 화면(티켓 스텁 애니메이션 없음, 모달
열기/닫기, 카운트다운 타이머 등)은 사용자가 직접 열어 확인 필요. 나머지 3개 서비스
(live-ranking/order-outbox/msa-checkout)로의 확장은 이번 결과 검토 후 별도 결정.

---

# waiting-room-persona-split — webhook-relay 수준으로 UI 전면 재개편

## 목표

waiting-room의 `panel.html`을 webhook-relay와 같은 깊이로 재개편한다: 실사용 페르소나
화면(줄서기 키오스크) + 공통 개발자 콘솔(로그/원시 상태) + 실제로 이 대기열 뒤에 있는
목적지를 보여주는 별도 데모 앱(webhook-relay의 Slack 채널에 대응). 사용자가 4개 서비스 중
waiting-room을 첫 적용 대상으로, "webhook-relay 수준 전면 재현"을 깊이로 선택함
(AskUserQuestion으로 확정).

## 현재 상태 (AS-IS)

`services/waiting-room/public/panel.html` 하나만 존재. 구조:
- `<h1>waiting-room · 대기열 패널</h1>` — 브랜드/헤더 개념 없음
- "내 티켓" 카드, "부하 시뮬레이션" 카드(burst 등록/중지/초기화 — 관리자 도구가 메인 화면에
  상시 노출), "전체 대기열" 그리드, "이벤트 로그" 카드(SSE, 메인 화면에 그대로 노출), 가이드
- `PanelUI.createLogger`/`connectSSE`만 사용 — `mountDevConsole`(webhook-relay가 이미 만든
  탭+드래그리사이즈 개발자 콘솔 공통 컴포넌트)은 아직 미사용
- 대기열 뒤에 있는 "실제 목적지"(입장 토큰으로 뭘 하는지)를 보여주는 화면이 없음 —
  `POST /rooms/:roomId/waiting-users/verify`(토큰 검증) API는 이미 존재하지만 panel.html
  어디서도 호출하지 않음

도메인 API(변경 없음, 전부 재사용):
- `POST/GET /rooms/:roomId/waiting-users`, `GET /rooms/:roomId/waiting-users/:userId`,
  `POST /rooms/:roomId/waiting-users/verify`
- `DELETE /admin/rooms/:roomId/waiting-users`, `POST /admin/rooms/:roomId/waiting-users/remove`
- `GET /admin/logs/stream`(SSE)

## 변경 후 상태 (TO-BE)

- `panel.html` — 실제 온라인 티켓팅 대기열 키오스크 페르소나:
  - 헤더 바(브랜드 + 현재 대기 인원 chip)
  - "내 티켓" 히어로 섹션 — 큰 숫자로 순번/상태 표시, 입장 가능해지면 "입장하기 →" 버튼이
    나타나 새 탭으로 `ticket-shop.html`을 염(실제 토큰을 쿼리파라미터로 전달)
  - 대기열 미리보기(기존 그리드, 축소된 형태로 유지)
  - "부하 시뮬레이션"(burst 등록/중지)과 "초기화"는 메인 화면에서 빼서 "테스트 도구" 모달로
    이동(webhook-relay의 "새 엔드포인트"/"테스트 이벤트 보내기" 모달과 같은 패턴)
  - "이벤트 로그" 카드 제거 → `PanelUI.mountDevConsole({streamUrl, tabs: [...]})`로 대체.
    탭 구성: "로그"(기존 SSE) + "대기열 원시 상태"(전체 대기자 목록을 position/userId 그대로
    보여주는 표, 2초 폴링 — circuit 원시값을 보여준 webhook-relay의 "엔드포인트 상태" 탭과
    동일한 역할)
- **신규** `public/ticket-shop.html` — webhook-relay의 `channel.html`(Slack 워크스페이스)에
  대응하는, "이 대기열이 실제로 지키고 있는 목적지"를 보여주는 완전히 별도 스타일의 데모 앱.
  실제 티켓 판매 사이트(인터파크/티켓마스터류)를 흉내낸 공연 티켓 구매 페이지:
  - URL 쿼리로 받은 토큰을 `POST /rooms/:roomId/waiting-users/verify`로 검증
  - 유효하면 공연 포스터/좌석 선택/구매 버튼이 있는 상점 화면 + `ADMITTED_TOKEN_TTL_SECONDS`
    (기본 300초)에 맞춘 카운트다운("구매 가능 시간: 4:59") — 실제 가상 대기열 뒤 티켓
    구매창이 흔히 갖는 제한시간 UX를 재현
  - 무효/만료면 "입장 권한이 없습니다 — 대기열로 돌아가기" 안내
  - panel.html과 완전히 다른 시각 언어(랩 공통 카드 스타일 대신 실제 커머스 사이트 톤)
- `panel.html`에도 webhook-relay의 "웹훅이 실제로 쓰이는 곳" 카드처럼, ticket-shop을 소개하는
  카드는 굳이 필요 없음 — "입장하기" 버튼이 곧 그 도착점이라 자연스럽게 이어짐(webhook-relay는
  발신자/수신자가 다른 서비스라 iframe으로 미리보기가 필요했지만, waiting-room은 한 사람의
  플로우 안에서 자연스럽게 다음 화면으로 넘어가는 구조라 iframe 미리보기 없이 링크로 충분)

## 변경 범위

| 파일 | 변경 내용 |
|------|----------|
| `services/waiting-room/public/panel.html` | 헤더/히어로 티켓/모달/개발자콘솔 구조로 전면 재작성 |
| `services/waiting-room/public/ticket-shop.html` | 신규 — 티켓 구매 데모 앱 |

백엔드(`src/**`) 변경 없음 — 기존 도메인/관리 API를 그대로 재사용.

## 영향성

| 영향 대상 | 영향 내용 |
|-----------|----------|
| waiting-room 도메인 API/서비스 로직 | 변경 없음 |
| 다른 3개 서비스(live-ranking/order-outbox/msa-checkout) | 변경 없음(이번 라운드는 waiting-room만) |
| `@forge-lab/panel-ui`(shared-panel-ui) | 변경 없음 — 이미 만들어진 `mountDevConsole` 재사용만 |
| dashboard | 변경 없음 — `forge-lab.json`의 `panelUrl`은 그대로 `panel.html` |

## Breaking Changes

없음 — 프론트엔드 전용 변경.

## 위험도

**LOW** — 백엔드 API/도메인 로직을 전혀 건드리지 않고 정적 파일(panel.html 재작성 +
ticket-shop.html 신규)만 추가/변경한다. 되돌리기 매우 쉬움.

## 작업 단계

### 1단계: panel.html 재구성

1. 헤더 바 + "내 티켓" 히어로 섹션(상태별 큰 표시, 입장 가능 시 "입장하기" 버튼)
2. 대기열 미리보기 그리드 축소 유지
3. 부하 시뮬레이션(burst)/초기화를 "테스트 도구" 모달로 이동
4. `mountDevConsole({streamUrl: "/admin/logs/stream", tabs: [{id:"queue-state", label:"대기열 원시 상태", pollMs:2000, render}]})` 적용, 기존 이벤트 로그 카드 제거
5. 가이드 문구 갱신

### 2단계: ticket-shop.html 신규 작성

1. URL 쿼리(`roomId`, `token`)를 읽어 `POST /rooms/:roomId/waiting-users/verify` 호출
2. 유효 시 공연 티켓 구매 데모 화면 + 5분 카운트다운, 무효 시 안내 화면
3. panel.html과 다른 독립 스타일(실제 커머스 사이트 톤)

### 3단계: 검증 + 문서화

1. Docker 재빌드·재기동 후 curl로 register→verify 흐름, admin reset/remove API 재확인
2. `node --check`로 인라인 스크립트 문법 확인, id 참조 무결성 확인
3. `services/waiting-room/ARCHITECTURE.md`에 이번 UI 개편 이력 추가
4. 이 플랜 파일에 실행 이력 추가

## 검증 방법

- `docker compose -f services/waiting-room/docker-compose.yml up -d --build`
- curl로 등록 → admission 대기 → (가능하면 관리자 API로 강제 admitted 상태 만들어) verify
  호출까지 실제 API 응답 확인
- panel.html/ticket-shop.html 인라인 스크립트 `node --check` 통과
- 기존 vitest 스위트(도메인 로직 테스트) 회귀 없음 확인

## 참조 규칙

- `.claude/rules/project/convention.md`의 "실사용 페르소나 화면 + 공통 개발자 콘솔" 절 — 이번
  작업이 그 컨벤션의 두 번째 적용 사례
- `.claude/rules/common/principles.md` — 백엔드는 건드리지 않고 필요한 만큼만 변경(과잉 확장 금지)
