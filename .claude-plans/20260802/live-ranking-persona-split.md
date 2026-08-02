## 플랜 실행 이력

### 완료: 2026-08-02

**결과**: 성공. 계획한 3단계 전부 완료.

**실제 변경 파일**:
- `services/live-ranking/public/panel.html` — 전면 재작성: 헤더 바(브랜드 + 참가자 chip),
  "내 순위" 히어로(참가하기/+10점 버튼 + 큰 순위/점수 표시), "전체 랭킹" 보드 유지, "📺 방송
  화면으로 보기" 링크(새 탭으로 `broadcast-overlay.html`). 이벤트 시뮬레이션/멱등성 확인/
  크래시 테스트/DLQ 유발/초기화는 "테스트 도구" 모달로 이동. 이벤트 로그 카드 제거 후
  `PanelUI.mountDevConsole({tabs:[{id:"dlq", label:"DLQ", pollMs:3000}]})`로 로그+DLQ(개수/
  최근 실패 목록/지우기 버튼) 탭 구성
- `services/live-ranking/public/broadcast-overlay.html` — 신규. webhook-relay의
  `channel.html`/waiting-room의 `ticket-shop.html`에 대응하는, 이 랭킹이 실제로 쓰이는
  곳(e스포츠/게임 방송 송출용 리더보드 오버레이, OBS 브라우저 소스 톤)을 보여주는 완전히
  별도 스타일의 데모. 어두운 그라디언트 배경, LIVE 펄스 배지, top1~3 골드/실버/브론즈 강조,
  점수 변경 시 flash 하이라이트. `GET /leaderboards/:id/top?limit=5` 1.5초 폴링 재사용(새
  API 불필요)

백엔드(`src/**`) 변경 없음 — 계획대로 기존 도메인/DLQ API를 그대로 재사용.

**계획과의 차이**: 없음.

**검증(2026-08-02)**: 기존 vitest 스위트(22개) 회귀 없음. `node --check`로 두 HTML의
인라인 스크립트 문법 확인, panel.html id 참조 무결성 확인. Docker 재빌드(aggregator만,
ingest는 정적 자산과 무관해 변경 없음)·재기동 후 curl로 이벤트 발행 → `top` API(limit=10,
limit=5 둘 다) 정확히 반영 확인, `/admin/dlq` 응답도 재확인. 테스트로 채운 랭킹은 리더보드
초기화로 정리.

**잔존 작업**: 브라우저 자동화 도구가 없어 실제 화면(모달 열기/닫기, 방송 오버레이의
펄스/플래시 애니메이션 등)은 사용자가 직접 열어 확인 필요. 남은 서비스(order-outbox/
msa-checkout)로의 확장은 이번 결과 검토 후 결정.

---

# live-ranking-persona-split — webhook-relay/waiting-room 수준으로 UI 전면 재개편

## 목표

live-ranking의 `panel.html`을 webhook-relay/waiting-room과 같은 깊이로 재개편한다: 실사용
페르소나 화면(게임 플레이어) + 공통 개발자 콘솔(로그/DLQ) + 이 랭킹이 실제로 쓰이는 목적지를
보여주는 별도 데모 앱(방송 리더보드 오버레이). 사용자가 waiting-room 다음으로 이 서비스를
선택함.

## 현재 상태 (AS-IS)

`services/live-ranking/public/panel.html` 하나만 존재(ticket-shop.html/channel.html에
대응하는 "실제 목적지" 데모 없음). 이미 `@forge-lab/panel-ui`의 CSS/`createLogger`/
`connectSSE`는 쓰고 있지만 `mountDevConsole`은 미도입 — 카드 6개(내 점수/이벤트
시뮬레이션/멱등성 확인/크래시 윈도우 재현/DLQ/전체 랭킹)+이벤트 로그+가이드가 전부 메인
화면에 평면 나열된, 재개편 이전 waiting-room과 동일한 구조.

도메인: ingest(3100, producer)가 `POST /leaderboards/:id/events`로 kafka-forge를 통해
점수 이벤트 발행 → aggregator(3101, consumer+조회)가 소비해 Redis ZSET(`ranking:{id}`)에
`zincrby` 반영. 조회 API: `GET /leaderboards/:id/top?limit`, `GET /leaderboards/:id/users/:userId`,
`DELETE /leaderboards/:id`(초기화), `GET/DELETE /admin/dlq`(실패 이벤트 확인용 로그),
`GET /admin/logs/stream`(SSE). 전부 변경 없이 재사용.

## 변경 후 상태 (TO-BE)

- `panel.html` — "게임 플레이어" 페르소나로 재구성:
  - 헤더 바(브랜드 + 참가자 관련 chip)
  - "내 순위" 히어로 — 참가하기/+10점 버튼 + 순위·점수 큰 표시(waiting-room 티켓 스텁과
    같은 톤의 히어로 카드)
  - "전체 랭킹"(top 10) 보드는 메인에 유지
  - "📺 방송 화면으로 보기" 링크 — `broadcast-overlay.html`을 새 탭으로 엶
  - 이벤트 시뮬레이션(버스트)/멱등성 확인/크래시 테스트/DLQ 유발/초기화는 전부 "테스트 도구"
    모달로 이동(webhook-relay/waiting-room과 동일한 패턴 — 이건 실제 플레이어가 안 누르는
    개발자 검증 액션)
  - 이벤트 로그 카드 제거 → `mountDevConsole({tabs:[{id:"dlq", label:"DLQ", pollMs:3000}]})`로
    "로그" 탭(기존 SSE)과 "DLQ" 탭(개수+최근 실패 목록+지우기 버튼, 기존 DLQ 카드 내용을
    그대로 옮김)으로 재구성
- **신규** `public/broadcast-overlay.html` — webhook-relay의 `channel.html`/waiting-room의
  `ticket-shop.html`에 대응하는, "이 랭킹 시스템이 실제로 쓰이는 곳"을 보여주는 완전히 다른
  스타일의 데모. 실제 e스포츠/게임 방송 송출 화면(OBS 브라우저 소스)을 흉내낸 상위 5명
  리더보드 오버레이 — 어두운 반투명 배경, 큰 폰트, "LIVE" 배지, 순위 변동 시 하이라이트
  애니메이션. `GET /leaderboards/:id/top?limit=5`를 그대로 폴링 재사용(새 API 불필요)

## 변경 범위

| 파일 | 변경 내용 |
|------|----------|
| `services/live-ranking/public/panel.html` | 헤더/히어로/모달/개발자콘솔 구조로 전면 재작성 |
| `services/live-ranking/public/broadcast-overlay.html` | 신규 — 방송 리더보드 오버레이 데모 |

백엔드(`src/**`) 변경 없음 — 기존 도메인/조회/DLQ API를 그대로 재사용.

## 영향성

| 영향 대상 | 영향 내용 |
|-----------|----------|
| live-ranking 도메인 API/kafka-forge 소비 로직 | 변경 없음 |
| 다른 서비스(webhook-relay/waiting-room/order-outbox/msa-checkout) | 변경 없음 |
| `@forge-lab/panel-ui` | 변경 없음 — 이미 만들어진 `mountDevConsole` 재사용만 |

## Breaking Changes

없음 — 프론트엔드 전용 변경.

## 위험도

**LOW** — 백엔드를 전혀 건드리지 않고 정적 파일(panel.html 재작성 + broadcast-overlay.html
신규)만 변경/추가한다.

## 작업 단계

### 1단계: panel.html 재구성

1. 헤더 + "내 순위" 히어로 섹션
2. 전체 랭킹 보드 유지, "방송 화면으로 보기" 링크 추가
3. 이벤트 시뮬레이션/멱등성 확인/크래시 테스트/DLQ 유발/초기화를 "테스트 도구" 모달로 이동
4. `mountDevConsole`로 로그+DLQ 탭 구성, 기존 DLQ 카드/이벤트 로그 카드 제거
5. 가이드 문구 갱신

### 2단계: broadcast-overlay.html 신규 작성

1. `GET /leaderboards/default/top?limit=5` 폴링(1~2초)
2. 방송 오버레이 톤(어두운 배경, 큰 폰트, LIVE 배지, 순위 변동 하이라이트)
3. panel.html과 완전히 다른 독립 스타일(랩 공통 CSS 미사용)

### 3단계: 검증 + 문서화

1. Docker 재빌드·재기동 후 curl로 이벤트 발행→top 반영, DLQ API 재확인
2. `node --check`로 인라인 스크립트 문법, id 참조 무결성 확인
3. `services/live-ranking/ARCHITECTURE.md`에 이번 UI 개편 이력 추가
4. 이 플랜 파일에 실행 이력 추가

## 검증 방법

- `docker compose -f services/live-ranking/docker-compose.yml up -d --build`
- curl로 점수 이벤트 발행 → `top` API에 반영되는 것 확인, DLQ 유발 이벤트로 `/admin/dlq` 확인
- 기존 vitest 스위트 회귀 없음 확인

## 참조 규칙

- `.claude/rules/project/convention.md`의 "실사용 페르소나 화면 + 공통 개발자 콘솔" 절 — 이번
  작업이 세 번째 적용 사례
- `.claude/rules/common/principles.md` — 백엔드는 건드리지 않고 필요한 만큼만 변경
