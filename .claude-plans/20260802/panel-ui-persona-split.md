## 플랜 실행 이력

### 후속: 2026-08-02 — channel.html을 진짜 Slack 워크스페이스 UI로 재설계 + 랩 화면과 시각적 분리

사용자 피드백: "슬랙을 모티브 한 거면 진짜 슬랙처럼 디자인해줘. 엔드포인트 세팅 같은 건
슬랙 외적인 거니까 디자인 다르게 해주고, 진짜 실활용 UI는 따로 빼서 진짜 슬랙처럼
활용되는 걸 구현해봤다는 느낌을 주도록." 이전 라운드의 channel.html은 우리 랩의
`panel-ui.css`(카드/버튼 등 공통 스타일)를 그대로 가져다 쓴 "채팅 느낌이 나는 카드"였을
뿐, 실제 Slack의 시각 언어(아우버진 사이드바, 채널 목록, 메시지 카드, 컴포저 등)는
아니었음.

**실제 변경 파일**:
- `services/webhook-relay/public/channel.html` — 전면 재작성. `/shared/panel-ui.css`/`.js`
  의존을 완전히 제거하고 독립적인 Slack 워크스페이스 UI로 새로 구현: 아우버진(#3f0e40)
  사이드바(워크스페이스 이름 + 채널 목록, 활성 채널은 파란 하이라이트, 리얼리티를 위한
  더미 채널 `#general`/`#random` 포함), 상단 채널 헤더(`# webhook-notifications` + 설명),
  메시지 리스트(그라디언트 아바타 + 봇 이름 + "APP" 뱃지 + 시각 + 본문 + Slack 어태치먼트
  스타일 payload 카드 — 검증 실패 시 좌측 보더가 빨간색으로 바뀜), 비활성 컴포저(이 채널은
  앱 전용이라는 안내)까지 실제 Slack 클라이언트 레이아웃 그대로 재현
- `services/webhook-relay/public/panel.html` — "실시간 알림 채널" 카드를 "웹훅이 실제로
  쓰이는 곳"으로 개편: 브라우저 창처럼 보이는 가짜 타이틀바(신호등 점 3개 + URL 표시)로
  iframe을 감싸서 "이건 랩 관리 화면과 별개의 완성된 앱"이라는 인상을 시각적으로 분리하고,
  "새 창에서 열기" 링크 추가

**계획과의 차이**: 없음 — 논의한 방향(Slack 실제 UI 재현 + 랩 화면과 시각적 분리) 그대로
구현. 백엔드(채널 방송 로직)는 이전 라운드에서 이미 완성돼 있어 변경 없음.

**검증(2026-08-02)**: `node --check`로 두 HTML의 인라인 스크립트 문법 확인, panel.html
id 참조 무결성 재확인. Docker 재빌드·재기동 후 curl로 이벤트 발행 → 배달 → 서명 검증 →
`/channel/stream` SSE 방송까지 파이프라인이 UI 변경 후에도 그대로 동작하는 것 재확인.

**잔존 작업**: 브라우저 자동화 도구가 없어 실제 Slack 느낌이 나는지(사이드바 색감, 메시지
레이아웃, 창 프레임 임베드)는 사용자가 직접 열어 확인 필요.

---

### 후속: 2026-08-02 — test-receiver를 "알림 채널"로 전환(웹훅의 실사용 효과를 눈에 보이게)

사용자 질문: "실제로 웹훅을 활용하는 실제 기능이 뭐가 있을까?" → 논의 끝에, webhook-relay의
근본적 약점은 수신 쪽(test-receiver)이 ok/fail/slow/timeout 시나리오만 흉내내는 더미라
"웹훅이 도착해도 눈에 보이는 실질적 효과가 없다"는 점으로 정리됨. Slack 인커밍 웹훅 채널을
흉내낸 실시간 알림 화면을 test-receiver에 추가해서 "보내기 → 실제로 뭔가 일어남"이라는
인과관계를 만들기로 함.

**실제 변경 파일**:
- `services/webhook-relay/src/shared/channel-message.ts` — `ChannelMessage{eventType, payload,
  verified, at}` 타입 신설
- `services/webhook-relay/src/test-receiver/app.module.ts` — `AdminEventsModule.forRoot({path:
  "channel"})` 추가(`/channel/stream` SSE)
- `services/webhook-relay/src/test-receiver/receiver.controller.ts` — `AdminEventBus` 주입,
  `@Body()`로 실제 웹훅 payload(`{eventId, type, payload, createdAt}`)를 받아 "fail" 시나리오를
  제외한 모든 경우(서명 검증 결과와 무관하게, 검증 실패도 눈에 보이게 `verified:false`로 표시)
  채널에 방송. "fail"은 이 엔드포인트가 애초에 처리를 못 하는 상황을 흉내내는 시나리오라 방송
  없음
- `services/webhook-relay/src/test-receiver/main.ts` — ingest와 동일한 패턴으로
  `useStaticAssets`(public/, /shared/) 추가 — 세 프로세스(ingest/delivery-worker/test-receiver)가
  같은 이미지·같은 public/ 디렉토리를 공유하므로 별도 복사 없이 바로 접근 가능
- `services/webhook-relay/public/channel.html` — 신규. Slack 채널 스타일 실시간 메시지 피드
  (avatar+봇 이름+시각+검증배지+event type+payload JSON), `/channel/stream` SSE 구독, 새 메시지
  올 때마다 자동 스크롤
- `services/webhook-relay/public/panel.html` — "실시간 알림 채널" 카드 추가, `channel.html`을
  `http://localhost:3401/channel.html`(호스트 매핑 포트) iframe으로 임베드해서 메인 화면을
  떠나지 않고도 웹훅 도착을 실시간으로 볼 수 있게 함. 가이드 문구에도 채널 언급 추가

**계획과의 차이**: 없음 — 논의한 방향 그대로 구현. 새 도메인 API는 추가하지 않고 순수하게
test-receiver의 부가 기능(채널 방송)과 프론트엔드(channel.html + iframe)만 추가.

**검증(2026-08-02)**: `tsc` 빌드·유닛테스트 19개 통과(회귀 없음), `node --check`로
panel.html/channel.html 인라인 스크립트 문법 확인, id 참조 무결성 스크립트 재확인. Docker
재빌드 후 curl로 실제 이벤트 발행 → delivery-worker 배달 → test-receiver 서명 검증 →
`/channel/stream` SSE로 정확한 eventType/payload/verified:true 수신까지 전체 파이프라인
재현 확인. "fail" 시나리오는 의도대로 채널에 아무것도 방송하지 않는 것도 별도로 확인.

**잔존 작업**: 브라우저 자동화 도구가 없어 iframe 임베드/채팅 UI의 실제 렌더링(아바타,
자동 스크롤 등)은 사용자가 직접 열어 확인 필요.

---

### 후속: 2026-08-02 — 메인 화면 전면 재개편(헤더/온보딩/모달 흐름)

사용자 피드백: "아직도 그냥 테스트 같다." 이전 라운드까지는 기술 데이터를 개발자 콘솔로
옮기긴 했지만, 메인 화면 자체는 여전히 "항상 펼쳐진 설정 폼 나열"이라 관리자 도구 느낌이
남아있었음. Svix/Hookdeck류 실제 웹훅 플랫폼의 오퍼레이터 콘솔 흐름(앱 만들기 온보딩 →
엔드포인트 목록 → 필요할 때만 여는 다이얼로그)으로 재구성.

**실제 변경 파일**: `services/webhook-relay/public/panel.html` 전면 재작성
- 상단 `<h1>` → 실제 앱 헤더바(로고+이름, 우측에 앱 API 키를 보여주는 tenant chip)
- 항상 보이던 "테넌트 생성" 인라인 폼 → 앱이 없을 때만 보이는 "시작하기" 온보딩 카드로 전환,
  앱이 생기면 사라지고 엔드포인트 카드가 나타남
- "엔드포인트 등록" 인라인 폼 제거 → "+ 새 엔드포인트" 버튼이 여는 모달 다이얼로그로 전환
- "이벤트 발행"/"5건 연속 발사(circuit 테스트)" 전역 폼 제거 → 각 엔드포인트 행의 "테스트
  이벤트 보내기" 버튼이 그 엔드포인트의 구독 타입을 미리 채운 모달을 열고, 그 안에서
  1건/5건(부하 테스트) 선택
- 엔드포인트 목록 위에 "N개 엔드포인트 · N 정상 · N 확인 중 · N 중단" 요약 칩 바 추가(실제
  대시보드가 흔히 보여주는 헬스 서머리)
- 개발자 콘솔("엔드포인트 상태" 탭)·가이드 카드 로직은 그대로 유지, 문구만 새 흐름에 맞게 수정

**계획과의 차이**: 이번 라운드는 사용자가 이전 결과물에 대한 불만("아직도 테스트 같다")으로
촉발된 추가 반복이라 원래 계획엔 없었음. 새 도메인 API는 추가하지 않음(기존 `/endpoints`,
`/events`, `/admin/endpoints/:id/circuit`, `/admin/endpoints/:id/deliveries` 그대로 재사용) —
모달/헤더/서머리는 전부 프론트엔드 전용 변경.

**검증(2026-08-02)**: `node --check`로 문법 확인, 모든 `getElementById` 참조 id가 정확히
한 번씩 존재하는지 스크립트로 대조, Docker 재빌드·재기동 후 curl로 앱 생성→엔드포인트 등록
API가 새 모달 흐름이 기대하는 그대로 동작하는 것 확인.

**잔존 작업**: 이번에도 브라우저 자동화 도구가 없어 모달 열기/닫기, 헤더 표시, 요약 칩 계산
같은 실제 시각적 동작은 사용자가 직접 열어 확인 필요. 계속 "테스트 같다"는 인상이면 구체적으로
어느 부분이 그런지 짚어주면 좋겠음(예: 색감/타이포/레이아웃 밀도 vs 여전히 남은 기능적 흐름).

---

### 후속: 2026-08-02 — burst 발행 후 상태 반영 지연 원인 설명 + 즉시 갱신 추가

사용자 질문: "5건 연속 발사해도 개발자 콘솔에서 상태 변화가 안 보인다, 딜레이가 있는 거냐?"

**원인**: `OUTBOX_PUBLISH_INTERVAL_MS`(기본 2초, `outbox-publisher.service.ts:31`)만큼
아웃박스 발행기가 실제 Kafka 발행을 시작하기까지 기다린다 — delivery row 자체는 `/events`
트랜잭션에서 즉시 생기지만, delivery-worker의 실제 HTTP 시도(→circuit 상태 변화)는 이
폴링 이후에야 일어난다. 여기에 개발자 콘솔 "엔드포인트 상태" 탭 자체의 2초 폴링까지 겹쳐서
최대 4~5초간 "변화 없음"으로 보일 수 있었다. 버그가 아니라 실제 트랜잭셔널 아웃박스 패턴이
갖는 의도된 지연(order-outbox와 같은 설계)이라 그 간격 자체는 건드리지 않고, UI 쪽에서
줄일 수 있는 폴링 지연만 손봤다.

**실제 변경 파일**:
- `services/webhook-relay/public/panel.html` — `publish-btn`/`burst-btn` 클릭 직후
  `refreshAll()`(엔드포인트 목록 + 개발자 콘솔 "엔드포인트 상태" 탭 강제 즉시 갱신)을
  호출하고, 아웃박스가 실제로 flush됐을 시점(+2.5초)에 한 번 더 호출. 가이드에 "발행 직후
  곧바로 바뀌지 않는다"는 안내 문구 추가

**검증(2026-08-02)**: `node --check`로 문법 확인, Docker 재빌드·재기동 후 curl로 fail
엔드포인트에 5건 동시 발행 → 1초 간격으로 circuit 상태를 폴링해 실제 OPEN 전환까지 걸리는
시간을 측정(이번 재현에서는 1초 이내에 OPEN 확인 — 아웃박스 폴링 주기 위상에 따라
2~3초까지도 걸릴 수 있음).

**잔존 작업**: 없음. `OUTBOX_PUBLISH_INTERVAL_MS` 자체를 낮춰 지연을 더 줄이는 건 실제
아웃박스 패턴의 검증 대상 지연을 인위적으로 없애는 것이라 이번엔 손대지 않음 — 필요하면
사용자가 요청할 사항으로 남겨둠.

---

### 후속: 2026-08-02 — 개발자 콘솔 고도화(탭+드래그 리사이즈) + 메인 화면 추가 단순화

사용자 피드백 2건 반영:
1. "엔드포인트 목록이 3초마다 깜빡인다" — `refreshEndpoints()`가 3초 폴링마다 목록 전체를
   다시 그리면서, 펼쳐져 있던 엔드포인트의 배달 타임라인까지 "불러오는 중" 플레이스홀더로
   초기화됐다가 2초 뒤 다시 채워지는 과정에서 박스 높이가 출렁여 열렸다 닫히는 것처럼
   보였음(1차 수정: 열린 타임라인 내용을 재구성 후에도 보존)
2. "개발자 콘솔에 최대 높이+드래그 리사이즈, UI는 더 실사용 느낌, 모든 데이터(로그/상태값)는
   개발자 도구처럼 메뉴(탭)로 고도화" — `mountDevConsole`을 탭 구조로 재설계하고, webhook-relay
   메인 화면에서 circuit 원시 상태·배달 시도 상세를 완전히 제거해 개발자 콘솔로 옮김

**실제 변경 파일**:
- `services/shared-panel-ui/dist/panel-ui.js` — `mountDevConsole`이 `options.tabs`(각
  `{id, label, pollMs?, render(container)}`)를 받아 탭 전환 가능하게 재설계. 탭 전환 시
  이전 탭의 폴링 인터벌은 정리(clear)하고 새 탭은 즉시 1회 렌더 후 `pollMs` 주기로 반복 렌더.
  상단 `.plui-dev-console-drag` 핸들에 pointerdown/move/up으로 높이 드래그 리사이즈 추가
  (최소 180px, 최대 뷰포트의 85%로 clamp)
- `services/shared-panel-ui/dist/panel-ui.css` — 탭 바(`.plui-dev-console-tabs/-tab`), 드래그
  핸들(`.plui-dev-console-drag`) 스타일 추가, 바텀시트를 `max-height` 고정값 대신 JS가 설정하는
  `height`(기본 40vh) + CSS `min-height`/`max-height` 안전값 조합으로 변경
- `services/webhook-relay/public/panel.html` — 메인 엔드포인트 목록을 클릭-펼침 방식에서
  완전히 손을 뗀 "상태 뱃지만 보여주는" 목록으로 단순화(circuit 상태를 "정상/복구 확인
  중/일시 중단" 친화적 pill로 매핑, 엔드포인트 ID/원시 상태 문자열/배달 상세는 화면에서
  제거). 개발자 콘솔에 "엔드포인트 상태" 탭(2초 폴링)을 추가해 circuit 원시 상태값 +
  엔드포인트별 배달 이력(시도횟수/에러/응답코드/dead 복구 버튼)을 그쪽으로 전부 이전

**계획과의 차이**: 원래 플랜(이번 문서 하단)은 "엔드포인트 클릭 → 메인 화면에 타임라인
펼침"이었으나, 사용자가 재검토 중 "모든 데이터는 개발자 도구에서 확인되게" 방향을 명확히
해서 그 타임라인 UI 자체를 메인 화면에서 걷어내고 개발자 콘솔 탭으로 옮기는 것으로 확장됨.

**검증(2026-08-02)**: `node --check`로 panel.html 인라인 스크립트/panel-ui.js 문법 확인.
Docker로 ingest 재빌드·재기동 후 curl로 테넌트 생성→엔드포인트 등록→이벤트 발행 재현,
`/endpoints`(메인 화면용)·`/admin/endpoints/:id/circuit`·`/admin/endpoints/:id/deliveries`
(개발자 콘솔 탭용) 응답이 새 렌더링 로직이 기대하는 형태와 정확히 일치하는 것 확인.

**잔존 작업**: 이번에도 브라우저 자동화 도구가 없어 드래그 리사이즈/탭 전환의 실제 클릭
상호작용은 코드 정적 검증(문법 체크)과 API 계약 검증까지만 했다 — 시각적 동작은 사용자가
직접 확인 필요.

---

### 완료: 2026-08-02

**결과**: 성공(webhook-relay 시범 적용).

**실제 변경 파일**:
- `services/shared-panel-ui/dist/panel-ui.js` — `mountDevConsole({streamUrl, title, formatMessage?})` 추가
- `services/shared-panel-ui/dist/panel-ui.css` — `.plui-dev-console-toggle`/`.plui-dev-console-sheet` 등 추가
- `services/webhook-relay/src/ingest/events.service.ts` — `toDeliveryView()` export로 분리(재사용)
- `services/webhook-relay/src/ingest/admin.controller.ts` — `GET /admin/endpoints/:id/deliveries` 추가
- `services/webhook-relay/public/panel.html` — 오퍼레이터 콘솔로 전면 재구성(엔드포인트 목록의
  circuit dot + 클릭 시 배달 타임라인, 데드레터/이벤트로그 카드는 타임라인/개발자콘솔로 흡수)
- `.claude/rules/project/convention.md` — "실사용 페르소나 화면 + 공통 개발자 콘솔" 절 추가

**계획과의 차이**: 없음 — 계획한 4단계 그대로 진행.

**검증(2026-08-02)**:
- `npm run build`, `npm test`(19개) 통과
- Docker로 ingest 재빌드·재기동 후 `panel.html`/`shared/panel-ui.js`/`.css`가 새 코드로
  서빙되는 것 확인
- curl로 실제 API 재현: 테넌트 생성→엔드포인트 등록→이벤트 발행→`GET
  /admin/endpoints/:id/deliveries`가 패널 타임라인이 기대하는 형태(status/attempts/
  lastError/responseStatus)로 정확히 반환되는 것 확인. fail 시나리오 5건 발행 후 circuit
  OPEN 전환 + "circuit open — 재시도 보류"로 보류된 delivery 확인. 강제로 dead 상태를
  만든 뒤 replay API 호출 → pending으로 정확히 복구되는 것까지 확인. SSE
  스트림(`/admin/logs/stream`)에서 `fanned_out` 이벤트 실시간 수신 확인(개발자 콘솔이
  구독할 대상)
- **주의**: 이 세션에는 브라우저 자동화 도구가 없어서, panel.html의 JS(엔드포인트 클릭 시
  타임라인 펼침, 개발자 콘솔 버튼 클릭 등)를 실제 브라우저 클릭으로 재현하지는 못했다.
  위 API 계약과 정적 자산 서빙은 전부 확인했지만, 시각적 레이아웃/인터랙션은 사용자가
  브라우저로 직접 열어 확인 필요.

**잔존 작업**: 나머지 3개 서비스(waiting-room/live-ranking/order-outbox/msa-checkout) 확장은
사용자가 webhook-relay 화면을 검토한 뒤 결정.

---

# panel-ui-persona-split — 패널을 "실사용 화면"과 공통 "개발자 콘솔"로 분리

## 목표

지금 4개 서비스의 `panel.html`이 전부 `@forge-lab/panel-ui` 공통 스타일 위에 똑같은 "관리자
CRUD 폼" 형태로 보여서 실사용 느낌이 안 든다는 피드백을 반영한다. (1) 시스템 로그/상태처럼
운영자스러운 정보는 화면 우측 하단 플로팅 버튼 → 바텀시트로 여는 공통 "개발자 콘솔"
컴포넌트로 몰아넣고, (2) 각 서비스의 메인 화면은 그 서비스가 흉내내는 실제 제품(webhook-relay
라면 Svix/Hookdeck류 웹훅 플랫폼 오퍼레이터 콘솔)의 페르소나만 남긴다. 이번 라운드는
webhook-relay 하나에 시범 적용하고, 검증되면 나머지 3개 서비스로 확장한다.

## 현재 상태 (AS-IS)

- `services/shared-panel-ui/dist/panel-ui.js` — `createLogger`(로그 줄 렌더링), `connectSSE`
  (EventSource 연결) 두 헬퍼만 존재. "떠 있는 버튼 + 바텀시트" 같은 레이아웃 컴포넌트는 없음.
- `services/shared-panel-ui/dist/panel-ui.css` — 카드/버튼/폼/로그/가이드 스타일만 존재.
- `services/webhook-relay/public/panel.html` — 테넌트 생성 / 엔드포인트 등록 / 이벤트 발행+
  circuit breaker 테스트 / 죽은 배달(dead) 목록+복구 / 이벤트 로그(SSE) / 가이드가 카드
  6개로 나란히 나열된 관리자 폼 형태. "엔드포인트별 배달 이력"을 한 곳에서 보는 화면이 없고,
  dead 목록·circuit 배지가 서로 다른 카드에 흩어져 있음.
- `services/webhook-relay/src/ingest/events.controller.ts`에 `GET /events/:id/deliveries`
  (이벤트 기준 배달 목록)는 있지만, **엔드포인트 기준** 배달 목록 조회 API는 없음.
- `docs`/`.claude/rules/project/convention.md`의 "패널 공유 UI" 절에는 아직 이 구조(페르소나
  화면 + 개발자 콘솔 바텀시트)에 대한 언급이 없음.

## 변경 후 상태 (TO-BE)

- `panel-ui.js`에 `PanelUI.mountDevConsole({ streamUrl, title })` 추가 — 호출 한 줄로 우측
  하단 원형 토글 버튼 + 바텀시트(열림/닫힘 애니메이션)를 DOM에 주입하고, 내부적으로 기존
  `createLogger`+`connectSSE`를 그대로 재사용해 SSE 로그를 바텀시트 안에 렌더링한다.
- `panel-ui.css`에 이 토글 버튼/바텀시트용 클래스(`.plui-dev-console-toggle`,
  `.plui-dev-console-sheet` 등)를 추가한다.
- webhook-relay의 `admin.controller.ts`에 `GET /admin/endpoints/:id/deliveries`를 추가해서
  엔드포인트 하나의 최근 배달 이력(타임라인)을 조회할 수 있게 한다.
- webhook-relay `panel.html`을 "엔드포인트 오퍼레이터 콘솔"로 재구성:
  - 테넌트 발급/엔드포인트 등록/이벤트 발행처럼 "설정" 성격은 상단에 축소된 형태로 남김
  - 엔드포인트 목록에 circuit 상태를 색상 dot으로 인라인 표시(별도 배지 카드 없앰)
  - 엔드포인트 클릭 시 그 엔드포인트의 최근 배달 타임라인이 펼쳐짐(시각/상태코드·에러/재시도
    버튼) — 지금 별도 카드였던 "죽은 배달 목록"은 이 타임라인의 한 상태(dead)로 흡수되고,
    복구(replay) 버튼도 타임라인 행에 인라인으로 붙는다
  - "이벤트 로그" 카드와 SSE 스트림은 화면에서 빠지고, 대신 우측 하단 개발자 콘솔(바텀시트)
    안으로 이동한다
- `.claude/rules/project/convention.md`의 "패널 공유 UI" 절에 이 컨벤션(메인 화면=페르소나,
  개발자 콘솔=공통 바텀시트)을 한 단락 추가한다.

## 변경 범위

| 파일 | 변경 내용 |
|------|----------|
| `services/shared-panel-ui/dist/panel-ui.js` | `mountDevConsole({ streamUrl, title })` 추가 |
| `services/shared-panel-ui/dist/panel-ui.css` | 토글 버튼/바텀시트 스타일 추가 |
| `services/webhook-relay/src/ingest/admin.controller.ts` | `GET /admin/endpoints/:id/deliveries` 추가 |
| `services/webhook-relay/src/ingest/admin.controller.ts` 또는 `events.service.ts` | `DeliveryView` 타입 재사용/공유 |
| `services/webhook-relay/public/panel.html` | 오퍼레이터 콘솔로 전면 재구성, 로그 카드 제거 → `mountDevConsole` 호출로 대체 |
| `.claude/rules/project/convention.md` | "패널 공유 UI" 절에 페르소나/개발자콘솔 컨벤션 추가 |

## 영향성

| 영향 대상 | 영향 내용 |
|-----------|----------|
| order-outbox / waiting-room / live-ranking / msa-checkout 패널 | 변경 없음(이번 라운드는 webhook-relay만). 단 `panel-ui.js`/`.css`에 추가만 하고 기존 `createLogger`/`connectSSE` 시그니처는 그대로 두므로 하위 호환 유지 |
| webhook-relay 도메인 API(`/endpoints`, `/events`) | 변경 없음. 신규 GET 조회 API 1개만 추가 |
| dashboard(`services/dashboard`) | 변경 없음 — iframe으로 `panelUrl`만 띄우므로 패널 내부 구조 변경과 무관 |

## Breaking Changes

없음 — 기존 `PanelUI.createLogger`/`connectSSE` API는 그대로 유지하고 `mountDevConsole`을
추가만 한다. webhook-relay의 기존 `/admin/deliveries/dead`, `/admin/deliveries/:id/replay`,
`/admin/endpoints/:id/circuit`, `/admin/logs/stream`도 그대로 유지(새 화면이 내부적으로 계속
사용).

## 위험도

**MEDIUM** — `shared-panel-ui`는 4개 서비스가 공유하는 공통 패키지라 여기 추가하는
컴포넌트가 이후 3개 서비스 확장의 기준선이 된다. 다만 이번 라운드는 추가(additive)뿐이고
기존 API를 건드리지 않아 다른 서비스에 즉시 영향은 없음. webhook-relay panel.html 자체
재구성은 순수 프론트엔드 변경이라 되돌리기 쉬움(LOW).

## 주의사항

- `mountDevConsole`은 이후 waiting-room/live-ranking/order-outbox/msa-checkout에도 그대로
  쓸 것을 가정하고 설계한다 — webhook-relay 전용 문구/클래스명을 하드코딩하지 않는다.
- 바텀시트는 `position: fixed`로 뷰포트 기준 배치하되, 반응형(좁은 화면)에서도 메인 콘텐츠를
  가리지 않게 max-height를 두고 스크롤 처리한다.
- `GET /admin/endpoints/:id/deliveries`는 관리자 전용 진단이 아니라 "엔드포인트라는 도메인
  리소스의 하위 조회"에 가까워 보일 수 있지만, 이미 `/admin/endpoints/:id/circuit`이 같은
  패턴으로 `/admin` 아래 있으므로 일관성을 위해 그대로 `/admin` 프리픽스를 유지한다.

## 작업 단계

### 1단계: 공통 개발자 콘솔 컴포넌트 (shared-panel-ui)

1. `panel-ui.css`에 우측 하단 원형 토글 버튼 + 슬라이드업 바텀시트 스타일 추가
2. `panel-ui.js`에 `mountDevConsole({ streamUrl, title })` 추가 — 버튼/시트 DOM 주입,
   열림/닫힘 토글, 내부적으로 `createLogger`+`connectSSE` 재사용

### 2단계: webhook-relay — 엔드포인트별 배달 이력 API

1. `admin.controller.ts`에 `GET /admin/endpoints/:id/deliveries` 추가(최근 N건, `DeliveryEntity`
   조회 후 `events.service.ts`의 `DeliveryView` 형태로 매핑 — 타입 export해서 재사용)

### 3단계: webhook-relay panel.html 재구성

1. 상단에 테넌트/엔드포인트 등록/이벤트 발행을 축소된 "설정" 영역으로 재배치
2. 엔드포인트 목록을 circuit 상태 dot 포함 리스트로, 클릭 시 배달 타임라인(상태/시각/에러/
   재시도 버튼) 펼침으로 재구성 — 기존 "죽은 배달" 카드/"delivery-list" 카드를 이 타임라인으로
   흡수
3. "이벤트 로그" 카드 제거, `PanelUI.mountDevConsole({ streamUrl: "/admin/logs/stream" })`
   호출로 교체
4. 가이드 문구를 새 화면 구조에 맞게 갱신

### 4단계: 컨벤션 문서화 + 검증

1. `.claude/rules/project/convention.md` "패널 공유 UI" 절에 이번 컨벤션 한 단락 추가
2. Docker로 webhook-relay 재기동 후 실사용 시나리오(엔드포인트 등록→이벤트 발행→성공/실패/
   circuit OPEN/죽은 배달 복구) + 개발자 콘솔 바텀시트 열기/로그 확인을 브라우저에서 재현

## 검증 방법

- `docker compose up -d --build ingest delivery-worker test-receiver`로 재기동 후 브라우저에서
  panel.html 접속
- 엔드포인트 목록에서 circuit 상태 dot이 실제 상태(CLOSED/OPEN)를 반영하는지 확인
- 엔드포인트 클릭 → 배달 타임라인에 이벤트 발행 후의 시도들이 정확히 나타나는지 확인
- 죽은 배달의 "복구" 버튼이 타임라인 안에서 동작하는지 확인
- 우측 하단 버튼 클릭 → 바텀시트가 열리고 SSE 로그(`fanned_out`/`replayed`)가 실시간으로
  쌓이는지 확인
- 기존 유닛 테스트(19개) 그대로 통과 확인(이번 변경은 프론트엔드+조회 API 1개 추가라 로직
  테스트 영향 없음)

## 참조 규칙

- `.claude/rules/project/convention.md`의 "패널 공유 UI" 절 — 이번 작업으로 갱신 대상
- `.claude/rules/common/principles.md` — 다른 3개 서비스로 확장은 "두 번째 사례가 실제로
  필요할 때" 진행(성급한 공통화 금지 원칙과 일치, 이번엔 webhook-relay 시범만)
