## 플랜 실행 이력

### 완료: 2026-08-02

**결과**: 성공. 계획한 3단계 전부 완료.

**실제 변경 파일**:
- `services/order-outbox/public/panel.html` — 전면 재작성: 헤더 바(브랜드 + 주문 수 chip),
  "주문하기" 히어로(생성 직후 "주문 조회하기 →" 링크가 `order-status.html?orderId=...`을
  새 탭으로 엶), "최근 주문" 목록 유지(행별 "조회" 링크 추가). "발행 실패 유발"(poison
  트리거)은 "테스트 도구" 모달로 이동. "죽은 outbox 레코드"/"이벤트 로그" 카드 제거 후
  `PanelUI.mountDevConsole({tabs:[{id:"outbox", label:"Outbox 상태", pollMs:3000}]})`로
  "로그"(api+fulfillment 두 SSE를 `devConsole.log()` 핸들로 합침) + "Outbox 상태"(dead-letter
  목록+복구 버튼) 탭 구성
- `services/order-outbox/public/order-status.html` — 신규. 다른 서비스들의 channel.html/
  ticket-shop.html/broadcast-overlay.html에 대응하는, 이 트랜잭셔널 아웃박스가 실제로
  이어지는 곳을 보여주는 완전히 다른 스타일(실제 쇼핑몰 주문조회/배송추적 페이지 톤)의
  데모. 주문번호 검색창 + 결제완료→상품준비중→배송확정 수직 타임라인(완료 체크마크/진행중
  펄스/대기 회색조). 기존 `GET /orders/:id`를 1.5초 폴링으로 재사용(새 API 불필요)

백엔드(`src/**`) 변경 없음 — 계획대로 기존 도메인/admin API를 그대로 재사용.

**계획과의 차이**: 없음.

**검증(2026-08-02)**: 기존 vitest 스위트(22개) 회귀 없음. `node --check`로 두 HTML의
인라인 스크립트 문법 확인, panel.html/order-status.html 둘 다 id 참조 무결성 확인. Docker
재빌드(api만, fulfillment는 정적 자산과 무관해 변경 없음)·재기동 후 curl로 주문 생성 →
`GET /orders/:id`가 실제로 created→published→confirmed까지 반영되는 것 확인(순식간에
전이돼 폴링 없이도 최종 confirmed 확인), poison 주문으로 5회 재시도 후 dead-letter API 응답
확인, revive API로 정상 복구되는 것까지 확인.

**잔존 작업**: 브라우저 자동화 도구가 없어 실제 화면(모달, 타임라인 펄스 애니메이션 등)은
사용자가 직접 열어 확인 필요. 남은 서비스(msa-checkout)로의 확장은 이번 결과 검토 후 결정.

---

# order-outbox-persona-split — webhook-relay/waiting-room/live-ranking 수준으로 UI 전면 재개편

## 목표

order-outbox의 `panel.html`을 앞선 3개 서비스와 같은 깊이로 재개편한다: 실사용 페르소나
화면(온라인 스토어에서 주문하는 손님) + 공통 개발자 콘솔(로그/outbox 원시 상태) + 이
트랜잭셔널 아웃박스가 실제로 이어지는 목적지를 보여주는 별도 데모 앱(주문 조회/배송추적
페이지). 사용자가 live-ranking 다음으로 이 서비스를 선택함.

## 현재 상태 (AS-IS)

`services/order-outbox/public/panel.html` 하나만 존재(다른 서비스의 channel.html/
ticket-shop.html/broadcast-overlay.html에 대응하는 "실제 목적지" 데모 없음). 이미
`@forge-lab/panel-ui`의 CSS/`createLogger`/`connectSSE`는 쓰고 있지만 `mountDevConsole`은
미도입 — 카드 4개(주문하기/주문 목록/죽은 outbox 레코드/이벤트 로그)+가이드가 메인 화면에
평면 나열된, 재개편 이전 다른 서비스들과 동일한 구조.

도메인: api(3200)의 `OrdersService.create()`가 주문 저장 + outbox row 저장을 하나의 DB
트랜잭션으로 커밋(dual-write 문제 차단) → `OutboxPublisherService`(5초 폴링)가 kafka-forge
`OutboxPublisher`로 Kafka(`order.created.v1`) 발행 → fulfillment(3201)의
`OrderCreatedConsumer`가 소비해 `confirmedAt` 세팅. `GET /orders/:id`가 `{id, item, amount,
stage, createdAt, publishedAt, confirmedAt}`을 반환(stage: created/published/confirmed).
실패 처리: 상품명이 `__outbox-fail__`이면 일부러 유효하지 않은 토픽으로 outbox row 생성 →
5회 재시도 후 dead-letter(`GET/POST /admin/outbox/dead`, `/admin/outbox/dead/:id/revive`).
전부 변경 없이 재사용.

## 변경 후 상태 (TO-BE)

- `panel.html` — "온라인 스토어에서 주문하는 손님" 페르소나로 재구성:
  - 헤더 바(브랜드 + 최근 주문 수 chip)
  - "주문하기" 히어로 — 상품명/수량 입력 + 주문 생성, 생성 직후 "주문 조회하기 →" 링크가
    나타나 `order-status.html?orderId=...`을 새 탭으로 엶
  - "최근 주문" 목록(기존 유지, 각 행에 "조회하기" 링크 추가)
  - "발행 실패 유발"(poison 트리거)은 "테스트 도구" 모달로 이동(고객이 안 누르는 개발자
    검증 액션)
  - "죽은 outbox 레코드" 카드 + "이벤트 로그" 카드 제거 → `mountDevConsole({tabs:[{id:"outbox",
    label:"Outbox 상태", pollMs:3000}]})`로 "로그"(기존 dual-SSE: api+fulfillment) +
    "Outbox 상태"(dead-letter 목록 + 복구 버튼, 기존 카드 내용 그대로 이동) 탭 구성
- **신규** `public/order-status.html` — 다른 서비스들의 channel.html/ticket-shop.html/
  broadcast-overlay.html에 대응하는, "이 트랜잭셔널 아웃박스가 실제로 이어지는 곳"을 보여주는
  완전히 다른 스타일의 데모. 실제 쇼핑몰(쿠팡/네이버쇼핑류) 주문 조회/배송 추적 페이지 톤 —
  주문번호 검색창 + 결제완료(created)→상품준비중(published)→배송확정(confirmed) 수직
  타임라인, 완료 단계 체크마크 + 진행 중 단계 펄스 표시. `GET /orders/:id`를 그대로
  폴링(1~2초) 재사용(새 API 불필요)

## 변경 범위

| 파일 | 변경 내용 |
|------|----------|
| `services/order-outbox/public/panel.html` | 헤더/히어로/모달/개발자콘솔 구조로 전면 재작성 |
| `services/order-outbox/public/order-status.html` | 신규 — 주문 조회/배송추적 데모 |

백엔드(`src/**`) 변경 없음 — 기존 도메인/admin API를 그대로 재사용.

## 영향성

| 영향 대상 | 영향 내용 |
|-----------|----------|
| order-outbox 도메인 API/outbox 발행/컨슈머 로직 | 변경 없음 |
| 다른 서비스(webhook-relay/waiting-room/live-ranking/msa-checkout) | 변경 없음 |
| `@forge-lab/panel-ui` | 변경 없음 — 이미 만들어진 `mountDevConsole` 재사용만 |

## Breaking Changes

없음 — 프론트엔드 전용 변경.

## 위험도

**LOW** — 백엔드를 전혀 건드리지 않고 정적 파일만 변경/추가한다.

## 작업 단계

### 1단계: panel.html 재구성

1. 헤더 + "주문하기" 히어로(생성 후 조회 링크 노출)
2. 주문 목록 유지 + 행별 "조회하기" 링크 추가
3. "발행 실패 유발"을 "테스트 도구" 모달로 이동
4. `mountDevConsole`로 로그+Outbox 상태(dead-letter+복구) 탭 구성, 기존 카드 제거
5. 가이드 문구 갱신

### 2단계: order-status.html 신규 작성

1. URL 쿼리(`orderId`) 또는 검색창으로 `GET /orders/:id` 호출, 1~2초 폴링
2. 결제완료→상품준비중→배송확정 수직 타임라인(완료/진행중/대기 상태 구분)
3. panel.html과 완전히 다른 독립 스타일(실제 쇼핑몰 주문조회 페이지 톤)

### 3단계: 검증 + 문서화

1. Docker 재빌드·재기동 후 curl로 주문 생성→발행→확인 3단계 반영, dead-letter API 재확인
2. `node --check`로 인라인 스크립트 문법, id 참조 무결성 확인
3. `services/order-outbox/ARCHITECTURE.md`에 이번 UI 개편 이력 추가
4. 이 플랜 파일에 실행 이력 추가

## 검증 방법

- `docker compose -f services/order-outbox/docker-compose.yml up -d --build`
- curl로 주문 생성 → `GET /orders/:id`로 stage가 created→published→confirmed로 전이되는 것
  확인, poison 주문으로 dead-letter API 재확인
- 기존 vitest 스위트 회귀 없음 확인

## 참조 규칙

- `.claude/rules/project/convention.md`의 "실사용 페르소나 화면 + 공통 개발자 콘솔" 절 — 이번
  작업이 네 번째 적용 사례
- `.claude/rules/common/principles.md` — 백엔드는 건드리지 않고 필요한 만큼만 변경
