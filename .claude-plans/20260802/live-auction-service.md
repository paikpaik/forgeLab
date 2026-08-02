## 플랜 실행 이력

### 완료: 2026-08-02

**결과**: 성공. 계획한 8단계 전부 완료.

**실제 변경 파일**: `services/live-auction/` 신규 워크스페이스 전체(package.json/tsconfig/
Dockerfile/docker-compose.yml/forge-lab.json/ARCHITECTURE.md, `src/app.module.ts`/`main.ts`,
`src/auction/`의 엔티티 2종·서비스·컨트롤러 2종·게이트웨이·종료폴러·DTO 2종·유닛테스트,
`public/panel.html`/`spectator.html`), `docs/architecture.md`(6번째 실험 추가, 부수적으로
webhook-relay가 mermaid 스타일 클래스에서 누락됐던 것도 같이 수정).

**계획과의 차이**:
- Docker 빌드가 GitHub Packages 인증(401)으로 막혔음 — 다른 5개 서비스는 예전에 성공한
  빌드 레이어 캐시를 그대로 재사용해서 문제가 안 드러났을 뿐이고, 완전히 새 이미지인
  live-auction은 `npm install`을 진짜로 다시 실행해야 해서 `NODE_AUTH_TOKEN`이 실제로
  필요했음. 사용자가 `services/live-auction/.env`에 토큰을 넣어준 뒤 정상 진행
- 스케일을 1로 축소한 뒤 재기동했을 때 Docker의 포트 범위(`3500-3502`) 매핑이 항상 3500에
  바인딩되는 걸 보장하지 않는다는 걸 실측으로 발견(한 번은 3501로 바인딩됨) — 코드 수정
  없이 ARCHITECTURE.md에 알려진 특성으로 기록

**검증(2026-08-02, 실제 컨테이너, 3인스턴스로 스케일)**:
- 다중 인스턴스 상태 일관성(3개 포트 전부 동일 조회) 확인
- 인스턴스 간 동시 입찰 레이스(3500에 낮은 값, 3501에 높은 값) → 순서 무관하게 항상 더 높은
  금액으로 수렴 확인(Redis 분산 락)
- **핵심 검증**: socket.io-client로 3500에 WS 연결 → 3501에 REST로 입찰 → 3500의 WS
  클라이언트가 실시간으로 수신(Redis pub/sub의 인스턴스 간 브로드캐스트 직접 증명)
- 동시 강제 종료 레이스(3500/3501 동시 호출) → 정확히 한쪽만 성공
- 자동 종료 폴러 다중 인스턴스 안전성 — 3개 인스턴스 SSE를 동시 구독한 채로 경매 자연
  만료 → "경매 종료" 이벤트가 정확히 1개 인스턴스에서 1회만 발생(waiting-room 다중 인스턴스
  검증에서 얻은 교훈을 설계 단계에서부터 반영한 결과)
- 유닛 테스트 8개 전부 통과(동시 입찰 레이스 테스트 포함, FakeRedisClient가 진짜 분산 락과
  동일한 promise 체이닝 직렬화로 검증)

**잔존 작업**: 없음. 상세 내용은 `services/live-auction/ARCHITECTURE.md` 참고.

---

# live-auction — 6번째 실험: 실시간 경매(WebSocket + Redis 분산 락/pub-sub)

## 목표

지금까지 5개 실험이 검증 안 한 node-forge 기능들 — Redis 분산 락(`withLock`), Redis
pub/sub(`publish`/`subscribe`), WebSocket 실시간 전송 — 을 실제 "실시간 경매" 서비스로
검증한다. 여러 참가자가 동시에 입찰가를 올리는 실시간 경매를, 여러 인스턴스로 스케일해도
정합성(최고 입찰자 확정)과 실시간 동기화(다른 인스턴스에 붙은 관전자도 즉시 봄)가 둘 다
성립하는지가 핵심 검증 대상이다. 사용자가 AskUserQuestion으로 "처음부터 다중 인스턴스
전제" + "Postgres(영구 기록) + Redis(실시간 상태/락/pub-sub)"를 확정함.

## 현재 상태 (AS-IS)

신규 실험. 참고할 기존 패턴:
- `msa-checkout`의 `withLock` 관련 API가 `ForgeRedisClient`에 이미 있지만(`lock`/`unlock`/
  `withLock`), 5개 실험 전부 실제로 쓴 적이 없음(grep으로 확인)
- `redis.publish`/`subscribe`도 5개 실험 전부 미사용
- WebSocket(`@nestjs/websockets`)도 5개 실험 전부 미사용(전부 REST+SSE+폴링 또는 gRPC)
- waiting-room에서 실측한 "여러 인스턴스가 조율 없이 폴러를 돌리면 관측(로그/지표)이
  깨진다"는 교훈을 이번엔 설계 단계에서부터 반영 — 경매 종료 폴러는 `UPDATE ... WHERE
  status='LIVE'`의 영향받은 행 수로 "내가 실제로 처리했는지"를 판단해 다중 인스턴스에서도
  중복 처리 없이 안전하게 만든다
- webhook-relay/waiting-room/live-ranking/order-outbox/msa-checkout이 이미 확립한 "실사용
  페르소나 + 공통 개발자 콘솔(`PanelUI.mountDevConsole`) + 별도 스타일 목적지 데모" 3단
  UI 구조를 이번엔 처음부터 반영

## 변경 후 상태 (TO-BE)

### 도메인 모델 (Postgres, TypeORM)
- `AuctionEntity`: `{id, title, description, startingPrice, minIncrement, status(LIVE|ENDED),
  currentHighestBid, currentHighestBidderId, endsAt, winnerId, finalPrice, createdAt}`
- `BidEntity`: `{id, auctionId, bidderId, amount, placedAt}` — 낙찰 안 된 입찰까지 전부 영구
  기록(실제 경매 감사 기록과 동일한 원칙)

### Redis(실시간 상태/락/pub-sub, 신규)
- `auction:{id}:current` 해시 — `{highestBid, highestBidderId}` 미러(빠른 조회용, Postgres가
  원본)
- `auction:{id}:lock` — `redis.withLock()`으로 "현재 최고가 조회 → 검증 → Postgres/Redis
  갱신"을 원자적으로 묶음. 이게 없으면 동시 입찰 두 건이 같은 "현재 최고가"를 보고 각자
  계산해서 나중에 쓴 쪽이 이겨버리는(낮은 입찰이 최종 승자가 되는) lost update가 남
- `auction:events` pub/sub 채널 — 입찰/종료 이벤트를 모든 인스턴스에 방송 → 각 인스턴스가
  자기한테 붙은 WebSocket 클라이언트에 전달(다중 인스턴스 실시간 동기화의 핵심)

### API
- `POST /admin/auctions` — 경매 생성(title, startingPrice, minIncrement, durationSeconds)
- `GET /auctions?status=LIVE` — 진행 중 경매 목록
- `GET /auctions/:id` — 현재 상태(Redis 우선 조회, 없으면 Postgres 폴백)
- `POST /auctions/:id/bids` — 입찰(락으로 보호)
- `GET /auctions/:id/bids` — 입찰 이력(감사/개발자 콘솔용)
- `POST /admin/auctions/:id/end` — 강제 종료(테스트용)
- `GET /admin/logs/stream` — SSE(다른 5개 실험과 동일한 AdminEventBus 패턴)

### WebSocket (`@nestjs/websockets` + socket.io)
- 클라이언트가 `join` 이벤트로 `auction:{id}` 룸에 참가
- 서버는 Redis pub/sub 채널을 구독, 메시지 수신 시 해당 룸에 `bid-placed`/`auction-ended`
  이벤트로 브로드캐스트 — **입찰을 처리한 인스턴스와 다른 인스턴스에 붙은 클라이언트도
  똑같이 받아야 검증이 성립**

### 다중 인스턴스
- 처음부터 다중 인스턴스 전제 — `docker-compose.yml`이 호스트 포트를 범위로 열어둬서
  (`3500-3502:3500`) 브라우저가 각 인스턴스에 직접 붙어 "다른 인스턴스로 들어온 입찰이
  내 화면에도 실시간으로 뜨는지" 바로 확인 가능
- 경매 종료 폴러(`@Interval`)는 `UPDATE ... WHERE status='LIVE'`의 영향 행 수로 커밋
  여부를 판단해 다중 인스턴스에서도 중복 없이 안전(waiting-room 교훈 반영)

### UI 3단 구조
- **panel.html(입찰자 페르소나)**: 진행 중 경매 선택 → 현재 최고가/마감까지 남은 시간 →
  입찰 입력 → WebSocket으로 다른 사람 입찰이 실시간 반영. 경매 생성/강제 종료/동시 입찰
  경쟁 테스트는 "테스트 도구" 모달
- **개발자 콘솔**: 로그 탭(SSE) + "원시 상태" 탭(Redis 현재 상태 해시 + 입찰 이력 원시
  목록, pollMs)
- **목적지 데모 `spectator.html`**: 관전자용 방송 화면(실제 경매장 전광판/중계 화면 톤,
  live-ranking의 broadcast-overlay.html과 톤은 유사하되 도메인은 다름) — WebSocket만으로
  구동되는 순수 read-only 화면, 낙찰 시 축하 애니메이션

## 변경 범위

| 파일 | 변경 내용 |
|------|----------|
| `services/live-auction/package.json`, `tsconfig.json`, `vitest.config.ts`, `Dockerfile` | 신규 — 다른 실험과 동일 스켈레톤 |
| `services/live-auction/docker-compose.yml` | 신규 — app(포트 범위)+postgres+redis |
| `services/live-auction/src/entities/{auction,bid}.entity.ts` | 신규 |
| `services/live-auction/src/auction/auction.service.ts` | 신규 — `withLock` 입찰 로직 |
| `services/live-auction/src/auction/auction.controller.ts` | 신규 — 도메인 API |
| `services/live-auction/src/auction/admin.controller.ts` | 신규 — `/admin/*` |
| `services/live-auction/src/auction/auction.gateway.ts` | 신규 — WebSocket + pub/sub 브리지 |
| `services/live-auction/src/auction/auction-closer.service.ts` | 신규 — 종료 폴러 |
| `services/live-auction/public/panel.html`, `spectator.html` | 신규 |
| `services/live-auction/ARCHITECTURE.md` | 신규 |
| `docs/architecture.md` | 6번째 실험 추가 |
| `package.json`(루트) workspaces | `services/*` 글롭이라 자동 포함, 별도 수정 불필요 |

## 영향성

다른 5개 서비스/공유 패키지에는 영향 없음(완전히 새로운 워크스페이스 패키지).

## Breaking Changes

없음(신규 서비스).

## 위험도

**MEDIUM** — 신규 인프라(Postgres+Redis 조합은 처음, WebSocket도 처음)에 다중 인스턴스
동시성까지 처음부터 검증해야 해서 손이 많이 감. 다만 기존 서비스는 전혀 안 건드리므로
격리도는 높음.

## 작업 단계

1. 스켈레톤(package.json/tsconfig/Dockerfile/docker-compose/forge-lab.json)
2. 엔티티 + DB 연결
3. AuctionService(withLock 입찰), Controller/AdminController
4. AuctionGateway(WebSocket + pub/sub), AuctionCloserService(다중 인스턴스 안전 종료)
5. panel.html + spectator.html + 개발자 콘솔
6. 유닛 테스트, 로컬 빌드
7. Docker 빌드·기동, 다중 인스턴스로 스케일해서 (a) 동시 입찰 레이스 정합성 (b) 인스턴스
   간 WebSocket 브로드캐스트 실측 검증
8. ARCHITECTURE.md, docs/architecture.md, 이 플랜 실행 이력 기록

## 검증 방법

- curl로 경매 생성 → 동시 입찰 2건(높은 값/낮은 값 뒤섞어서) → 최종 최고가가 실제로 더 높은
  쪽으로 정확히 수렴하는지 확인(락이 없으면 나중에 쓴 쪽이 이겨서 낮은 값이 남을 수 있음)
- socket.io-client 기반 간단 스크립트로 인스턴스 A에 WS 연결 → 인스턴스 B에 REST로 입찰 →
  인스턴스 A의 WS 클라이언트가 브로드캐스트를 받는지 확인(다중 인스턴스 동기화 핵심 검증)
- 경매 종료 폴러를 다중 인스턴스로 돌려도 winner/finalPrice가 한 번만 확정되는지 확인
- 유닛 테스트 회귀(신규라 없음, 새로 작성한 테스트가 통과하는지)

## 참조 규칙

- `.claude/rules/project/convention.md`의 "실사용 페르소나 화면 + 공통 개발자 콘솔" 절
- `.claude/rules/common/principles.md` — 첫 실험 범위만 구현, 두 번째 필요해질 때 확장
