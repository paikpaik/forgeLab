## 플랜 실행 이력

### 후속: 2026-08-01 — OutboxPublisherService.flush() try/catch 추가 (오래된 P0 해소)

kafka-forge `OutboxPublisher.publishPending()` 소스를 다시 읽어서 `fetchPending()`(DB 조회)이
try/catch 밖에 있다는 걸 확인. redpanda를 내리는 것으로는 재현이 안 됐고(개별 레코드 실패는
이미 내부에서 흡수됨), **Postgres를 내려야** 재현됨 — `flush()`에 try/catch 추가 후 구조화된
로그로 정상 캐치되는 것, 폴러가 안 죽고 계속 재시도하는 것, Postgres 복구 후 자동 회복까지
실제 컨테이너로 검증(자세한 내용은 `ARCHITECTURE.md`의 2026-08-01 후속 참고).

### 후속: 2026-08-01 — 데드레터 레코드 복구(revive) API + UI (오래된 P0 해소)

우선순위 정리 때부터 미뤄져 있던 P0("데드레터 레코드 확인만 되고 복구 수단이 없음")를 처리.
`TypeormOutboxStore.revive(id)` 추가(poison topic이면 정상 topic으로 고쳐서 재시도 가능하게),
`POST /admin/outbox/dead/:id/revive` 엔드포인트, panel.html에 "복구" 버튼. 실제 poison 주문을
만들어 dead-letter까지 재현한 뒤 revive 호출 → 8초 뒤 `stage: confirmed`로 전이되는 것까지
end-to-end 검증(자세한 내용은 `ARCHITECTURE.md`의 2026-08-01 후속 참고). 유닛 테스트 22개
전부 통과.

### 후속: 2026-07-19 (kafka-forge 1.0.5 채택 — outbox 부분 실패/영구 블로킹 수정 + dead-lettering)

"냉정하게 order-outbox를 평가하고 forge 모듈/패널 개선점을 파악해달라"는 요청으로
`OutboxPublisher.publishPending()` 소스를 읽다가 배치 중 한 건 실패 시 그 이전 성공분도
`markPublished` 안 되고 예외가 던져지는 구조를 발견 — 이론으로 끝내지 않고 `docker exec ...
psql`로 정상 row/독성 topic row/정상 row를 순서대로 직접 삽입해 실제로 재현: 정상 앞 row가
5초 폴링마다 중복 발행(`produced_total` 40초간 +5), 독성 row는 무한 재시도
(`produce_errors_total` +9), 뒤쪽 정상 row는 테스트 기간 내내 미발행(영구 블로킹).

사용자가 "실패건은 dlq로 가는 게 맞지 않냐"고 제안 → 제안서 2건 작성(부분 실패 수정은 순수
버그 픽스, dead-letter는 `OutboxStore.markFailed?` 훅 하나만 추가하는 최소 설계로 — 정책
전부는 저장소 책임에 위임, kafka-forge 자신의 "저장소 구현에 의존하지 않는다" 원칙과
`IdempotencyStore.claim`/`release` 선례에 따라 이 방향을 추천, 사용자 승인) → 사용자가
kafka-forge 1.0.5로 반영.

**실제 변경 파일**:
- `src/entities/outbox-record.entity.ts` — `attempts`(int, default 0), `lastError`(nullable),
  `deadAt`(nullable, ISO 문자열) 컬럼 추가
- `src/api/typeorm-outbox-store.ts` — `markFailed(id, error)`(5회째 `deadAt` 세팅),
  `listDead(limit)` 신규, `fetchPending`에 `deadAt IS NULL` 조건 추가
- `src/api/outbox.controller.ts` — 신규, `GET /outbox/dead`
- `src/api/orders.service.ts`, `src/shared/constants.ts` — `OUTBOX_POISON_ITEM`/
  `OUTBOX_POISON_TOPIC` 트리거 추가(live-ranking의 `DLQ_TEST_USER_ID` 컨벤션과 동일)
- `src/api/typeorm-outbox-store.test.ts`, `orders.service.test.ts` — dead-lettering
  테스트 3건 추가(총 19개)
- `public/panel.html` — "죽은 outbox 레코드" 카드 + "발행 실패 유발" 버튼
- `ARCHITECTURE.md` — mermaid에 `OutboxController`/dead 흐름 추가, 알려진 한계 행을 해결로
  갱신, 설계 결정 2건 추가, 검증 이력 후속 섹션 추가
- `docs/issues.md` — kafka-forge 1.0.5 이슈 2건(HIGH/MEDIUM) 추가

**계획과의 차이**: 없음(사용자 요청 기반 후속 라운드, 별도 사전 계획 문서 없이 진행).

**검증**: `docker compose up --build -d` 후 실제 컨테이너 대상으로 사전 정상 주문 → 포이즌
주문 → 사후 정상 주문 순서로 3건 생성, 25초(5초 × `OUTBOX_MAX_ATTEMPTS`=5) 대기 후 확인 —
사전/사후 주문 모두 `stage: "confirmed"`(사후 주문이 정상 처리됐다는 게 영구 블로킹 해소의
직접 증거), 포이즌 주문은 `stage: "created"`로 고정 + `GET /outbox/dead`에 `attempts: 5`
세팅 확인, `kafka_forge_produced_total` = 2(중복 없음), `kafka_forge_produce_errors_total` =
5(정확히 MAX_ATTEMPTS에서 멈춤, 무한 재시도 해소). vitest 19개 전부 통과. 검증 후
`TRUNCATE orders, outbox_records`로 테스트 데이터 정리.

**잔존 작업**: 없음. (별도, 낮은 우선순위로 남겨둔 것: `OutboxPublisherService.flush()`에
try/catch가 없어 예외가 NestJS Scheduler 레벨 로그로만 보임 — 애플리케이션 레벨의 깔끔한
에러 로그가 아님. 이번 라운드 스코프 아님.)

---

### 후속: 2026-07-19 (이벤트 로그가 "발행됨"을 건너뛰던 문제)

사용자가 "3개 주문을 만들었는데 발행됨으로 안 가고 바로 확인됨으로 넘어간다"고 리포트.
원인 분석 결과 버그가 아니라 outbox 폴링 주기(5초)와 무관하게 발행→소비(카프카 컨슈머
반응)가 훨씬 짧게(실측 12ms) 끝나서, 패널의 1초 폴링이 "발행됨" 상태를 관측할 기회 자체가
거의 없었던 것. 사용자가 "폴링 방식이 맞는 방식 아니야?"라고 확인 질문 — 폴링 자체는
유지하고(waiting-room/live-ranking과 동일 컨벤션), 폴링이 실어오는 정보를 "현재 상태"에서
"실제 전이 시각"으로 풍부하게 만드는 방향으로 합의.

**실제 변경 파일**:
- `src/entities/order.entity.ts` — `confirmedAt`(nullable, ISO 문자열) 컬럼 추가
- `src/fulfillment/order-created.consumer.ts` — `confirmedAt`을 `WHERE confirmedAt IS NULL`
  조건으로 최초 1회만 세팅(재배달 시 관측 정보 훼손 방지)
- `src/api/orders.service.ts` — `OrderView`에 `publishedAt`/`confirmedAt` 노출
- `src/api/orders.service.test.ts` — 노출 값 검증 테스트 갱신
- `public/panel.html` — 이벤트 로그를 poll snapshot 비교(`lastStages`) 대신
  `publishedAt`/`confirmedAt` 존재 여부 + `loggedTransitions` Set으로 재작성, 로그 시각도
  실제 전이 시각으로 표시. 가이드 문구도 갱신
- `ARCHITECTURE.md` — 설계 결정 2건 추가, 검증 이력 후속 섹션 추가

**계획과의 차이**: 없음(이번 라운드는 사용자 피드백 기반 후속 작업이라 별도 계획 문서 없이
바로 진행).

**검증**: 주문 생성 → 8초 후 조회 시 `publishedAt`/`confirmedAt`이 실제 값으로 채워지는 것
확인(발행 08:57:29.108 → 확인 08:57:29.120, 12ms 차이로 폴링이 못 잡는 이유를 수치로 재확인).
panel.html 반영 확인, vitest 15개 유지하며 통과.

**잔존 작업**: 없음.

---

### 완료: 2026-07-19

**결과**: 성공

**실제 변경 파일**:
- `services/order-outbox/package.json`, `tsconfig.json`, `.npmrc`, `.env` — 스캐폴딩
  (typeorm, pg, better-sqlite3(devDep), @nestjs/schedule 추가 포함)
- `src/entities/order.entity.ts`, `outbox-record.entity.ts` — TypeORM 엔티티. id는
  애플리케이션에서 `randomUUID()`로 직접 생성(`@BeforeInsert` 훅 대신 — plain object
  save()에서는 훅이 안 발동하는 TypeORM 특성 때문). `publishedAt`은 ISO 문자열(varchar),
  `payload`는 `simple-json` — 둘 다 Postgres/SQLite 드라이버 무관하게 동작하도록
- `src/shared/order-created.contract.ts`, `constants.ts`, `kafka-health.ts`
- `src/api/*` — `OrdersController`/`OrdersService`(트랜잭션 insert), `TypeormOutboxStore`,
  `OutboxPublisherService`(`@Interval`), `OrdersMetrics`, `KafkaClientModule`, `app.module.ts`,
  `main.ts`(panel.html 서빙, CORS 불필요)
- `src/fulfillment/*` — `OrderCreatedConsumer`, `KafkaClientModule`, `app.module.ts`, `main.ts`
  (health/metrics만, 비즈니스 API 없음)
- `public/panel.html` — 주문하기 + 생성됨/발행됨/확인됨 3단계 표시
- `Dockerfile`(이미지 1개), `docker-compose.yml`(api/fulfillment/postgres/redpanda 4서비스),
  `forge-lab.json`
- `src/test-utils/create-test-data-source.ts`(SQLite in-memory) + vitest 3개 파일(15 테스트):
  `order-created.contract.test.ts`, `typeorm-outbox-store.test.ts`, `orders.service.test.ts`
- `ARCHITECTURE.md` — 신규, `docs/architecture.md` — 세 번째 실험 노드 추가

**계획과의 차이**:
- Docker 빌드 단계에서 `@nestjs/schedule`이 워크스페이스 호이스팅 때문에 로컬 tsc는
  통과했지만 격리된 Docker 빌드에서는 못 찾는 걸 발견 → package.json에 명시적으로 추가.
- 계획에는 없었지만 구현 중 발견 — TypeORM 컬럼 타입을 전부 명시해야 했음(vitest/esbuild가
  emitDecoratorMetadata를 안 방출해서 타입 추론 데코레이터가 테스트에서 깨짐), id 생성 방식을
  `@BeforeInsert` 훅에서 서비스 코드의 명시적 `randomUUID()`로 변경, `publishedAt`/`payload`
  컬럼 타입을 드라이버 무관 타입(varchar/simple-json)으로 변경 — 전부 "실제 SQLite로
  테스트한다"는 결정에서 파생된 조정.
- 계획에서 "fake DB로 테스트"를 암묵적으로 가정했었는데, TypeORM API 표면이 넓어서 실제
  SQLite in-memory(`better-sqlite3`) 사용으로 방향을 바꿈 — waiting-room/live-ranking의
  FakeRedisClient 패턴과 다른 선택.

**검증**: Docker 4개 컨테이너 기동 → 주문 생성 → `stage: "created"` 즉시 확인 →
~12초 후 `stage: "confirmed"`로 전환 실제 확인(트랜잭션 원자성 + outbox 폴러 + 다운스트림
컨슈머 전체 경로 재현). 관련 지표(생성/발행/소비/성공) 전부 1로 정확히 찍힘. vitest 15개
전부 통과(실제 SQLite in-memory DB 기반).

**잔존 작업**: kafka-forge `OutboxPublisher.publishPending()`의 배치 부분 실패 시 중복
재발행 가능성을 소스 레벨에서 발견했으나 이번 스코프에서는 재현/수정 안 함 —
`ARCHITECTURE.md`에 알려진 한계로 기록, 추후 냉정한 분석 대상.

---

# order-outbox-pipeline — 트랜잭셔널 아웃박스 패턴 (세 번째 실험)

## 목표

forge-lab의 세 번째 실험. waiting-room(node-forge: redis/response/logger/metrics/health),
live-ranking(kafka-forge: producer/consumer/재시도/DLQ/멱등성)에 이어, 이번엔 지금까지 안
건드려본 node-forge의 **`database`**(TypeORM DataSource)와 kafka-forge의
**`OutboxPublisher`/`OutboxStore`**를 검증한다. "DB 쓰기와 이벤트 발행을 어떻게 원자적으로
묶는가"(dual-write 문제)를 트랜잭셔널 아웃박스 패턴으로 실제로 구현하고 확인한다.

## 현재 상태 (AS-IS)

- `services/waiting-room`, `services/live-ranking` 둘 다 Redis만 쓰고 SQL DB는 한 번도
  안 씀. node-forge의 `database`/`DatabaseModule`은 API만 확인했고 실사용 검증 없음
  (`forRoot(typeormOptions)` → `@Global()` 모듈, `@InjectDataSource()`로 주입, RedisModule과
  동일 패턴 확인 완료).
- kafka-forge의 `OutboxPublisher`/`OutboxStore`도 export만 되어 있고 forge-lab에서 한 번도
  안 씀. 소스 확인 결과 `publishPending(limit)`은 폴링 방식(내장 스케줄러 없음, 소비 서비스가
  직접 `@Interval`로 호출해야 함)이고, 배치 중 하나라도 발행 실패하면 그 전에 성공한 것들도
  `markPublished`가 호출되지 않아 다음 폴링에서 재발행(중복 발행)될 수 있는 지점을 소스
  레벨에서 미리 확인해둠(이번 구현 스코프는 아니고, 추후 냉정한 분석 대상으로 남김).

## 변경 후 상태 (TO-BE)

```
services/order-outbox/
├── src/
│   ├── api/                              주문 API + outbox 폴러 (port 3200)
│   │   ├── main.ts                       public/panel.html 서빙 (같은 오리진, CORS 불필요)
│   │   ├── app.module.ts                 DatabaseModule + KafkaClientModule + Logger/Metrics/Health
│   │   ├── orders.controller.ts          POST /orders, GET /orders, GET /orders/:id
│   │   ├── orders.service.ts             DataSource.transaction()으로 order+outbox_record insert
│   │   ├── typeorm-outbox-store.ts       kafka-forge OutboxStore 구현 (fetchPending/markPublished)
│   │   ├── outbox-publisher.service.ts   @Interval(5초) → OutboxPublisher.publishPending()
│   │   └── dto/create-order.dto.ts
│   ├── fulfillment/                      다운스트림 컨슈머 (port 3201, health/metrics만)
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   └── order-created.consumer.ts     StandardConsumer.subscribe → order.status='confirmed'
│   ├── entities/
│   │   ├── order.entity.ts               TypeORM @Entity (두 프로세스가 재사용)
│   │   └── outbox-record.entity.ts       TypeORM @Entity (kafka-forge OutboxRecord 형태)
│   └── shared/
│       ├── order-created.contract.ts     defineEvent (createTopicName("order","created",1))
│       └── constants.ts
├── public/panel.html                     주문하기 폼 + 상태(생성됨/발행됨/확인됨) 실시간 표시
├── Dockerfile                             이미지 1개, docker-compose command로 api/fulfillment 구분
├── docker-compose.yml                     postgres + redpanda + api + fulfillment
└── forge-lab.json                        panelUrl → api(3200)
```

### 핵심 설계

- **order.status 3단계**: `outbox_records.publishedAt`(폴러가 발행 완료 시 세팅)과
  `order.status`(fulfillment가 confirmed로 세팅) 조합으로 "생성됨(outbox 미발행) →
  발행됨(Kafka로 나갔지만 fulfillment 반영 전) → 확인됨" 3단계를 계산해서 노출한다 —
  DB 커밋→outbox 발행 지연과 발행→컨슈머 반영 지연을 패널에서 각각 눈으로 볼 수 있게.
- **api/fulfillment 프로세스 분리**: live-ranking의 producer/consumer 분리와 같은 맥락이나,
  이유는 다르다 — live-ranking은 "둘 다 진짜 HTTP API를 가져서 한 포트에 억지로 묶이는 게
  이상했던" 경우였고, order-outbox는 HTTP API가 애초에 api 프로세스 하나뿐이라(fulfillment는
  health/metrics만) 억지로 묶이는 문제 자체가 없다. 그래도 사용자가 처음부터 분리하는 쪽을
  선택함(추후 fulfillment가 진짜 다른 팀/서비스가 되는 걸 가정하면 자연스러움).
- **Redis 없음**: 멱등성/저장 전부 Postgres(outbox 테이블 유니크 제약, order 테이블)로 처리 —
  이 실험이 Redis 없이 가는 첫 사례.
- **DLQ 관측성 재구현 안 함**: live-ranking에서 이미 검증된 기능이라 스코프 아웃, `StandardConsumer`
  기본 재시도/DLQ만 사용.
- **TypeORM `synchronize: true`**: 마이그레이션 도구 없이 엔티티로 테이블 자동 생성 — 랩
  환경이라 이 정도로 충분하다고 판단(실 서비스라면 지양할 설정이라는 걸 인지하고 있음).

## 변경 범위

| 파일 | 변경 내용 |
|------|----------|
| `services/order-outbox/**` | 신규 — 위 구조 전체 |
| `docs/architecture.md` | 전체 아키텍처 다이어그램에 세 번째 실험 노드 추가 |

## 영향성

| 영향 대상 | 영향 내용 |
|-----------|----------|
| waiting-room, live-ranking | 변경 없음 — 완전히 독립된 workspace |
| dashboard | 변경 없음 — panelUrl 방식은 이미 범용 |
| node-forge / kafka-forge | 코드 변경 없음(참고만), 실사용 중 gap 발견 시 `proposals/`에 작성 |

## Breaking Changes

없음 — 신규 workspace 추가만 발생.

## 위험도

**MEDIUM** — Postgres를 docker-compose에 처음 추가(waiting-room=Redis만, live-ranking=Redis+Kafka).
TypeORM 트랜잭션 경계, 두 프로세스가 같은 DataSource/엔티티를 공유하는 구조가 처음이라
예상 못한 이슈 가능성. outbox 발행 로직 자체(kafka-forge가 제공)는 이미 소스까지 확인해서
LOW에 가까움.

## 주의사항

- `forge/node-forge`, `forge/kafka-forge` 소스는 참고만 하고 실제 의존성은
  `npm install @paikpaik/node-forge @paikpaik/kafka-forge`로 설치(GitHub Packages, 현재
  1.0.4).
- outbox 발행 폴러(`OutboxPublisherService`)와 주문 생성 API가 반드시 **같은 Postgres
  DataSource**를 봐야 한다(같은 트랜잭션에서 커밋된 outbox row를 폴러가 바로 읽을 수 있어야
  함) — api 프로세스 안에 둘 다 위치.
- `order-created.contract.ts`의 토픽명은 `createTopicName()`을 거쳐서만 생성(kafka-forge 컨벤션).

## 작업 단계

### 1단계: workspace 스캐폴딩

1. `package.json`/`tsconfig.json`(waiting-room/live-ranking 컨벤션), `.npmrc`, `.env`
2. `npm install @paikpaik/node-forge @paikpaik/kafka-forge typeorm pg zod` 등
3. `src/shared/order-created.contract.ts`, `src/entities/*.entity.ts`

### 2단계: api 프로세스

1. `OrdersController`/`OrdersService`(트랜잭션 insert), `dto/create-order.dto.ts`
2. `TypeormOutboxStore`, `OutboxPublisherService`(`@Interval`)
3. node-forge `DatabaseModule`/`KafkaClientModule`/`Logger`/`Metrics`/`Health`(DB+Kafka 체커) 연결

### 3단계: fulfillment 프로세스

1. `OrderCreatedConsumer`(`StandardConsumer.subscribe` → order.status 업데이트)
2. 동일 `DatabaseModule`/`KafkaClientModule`/`Logger`/`Metrics`/`Health` 연결(HTTP 비즈니스
   API 없음)

### 4단계: panel.html + Docker

1. 주문하기 폼, 주문 목록(생성됨/발행됨/확인됨 3단계 표시), 이벤트 로그
2. `Dockerfile`(1개), `docker-compose.yml`(postgres, redpanda, api, fulfillment 4서비스),
   `forge-lab.json`

### 5단계: 테스트 및 검증

1. vitest: `TypeormOutboxStore`(실제 DB 없이 fake DataSource/repository로), 이벤트 스키마
2. Docker로 주문 생성 → 3단계 상태 전환이 실제로 순서대로 일어나는지 확인
3. `ARCHITECTURE.md` 작성

## 검증 방법

- `npm test` 전부 통과
- Docker compose로 4개 컨테이너(postgres, redpanda, api, fulfillment) 기동 확인
- `POST /orders` 후 주문이 "생성됨" → (몇 초 내) "발행됨" → (몇 초 내) "확인됨"으로 순서대로
  바뀌는 것 curl/panel에서 확인
- 브라우저에서 panel.html로 주문 생성 후 3단계 전환이 실시간으로 보이는지 확인

## 참조 규칙

- `.claude/rules/common/principles.md` — 프로세스 분리(api/fulfillment)는 사용자와 확인 후 결정
- `.claude/rules/project/convention.md` — forge 의존성은 GitHub Packages로 설치, dashboard는
  panelUrl로만 연결
