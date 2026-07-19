# order-outbox 아키텍처

트랜잭셔널 아웃박스 패턴. forge-lab의 세 번째 실험이며, waiting-room(node-forge: redis 등),
live-ranking(kafka-forge: producer/consumer/재시도/DLQ/멱등성)에 이어 지금까지 안 건드려본
**node-forge의 `database`**(TypeORM)와 **kafka-forge의 `OutboxPublisher`/`OutboxStore`**를
검증한다. "DB 쓰기와 이벤트 발행을 어떻게 원자적으로 묶는가"(dual-write 문제)를 실제로
구현해서 확인한다. 레포 전체 구조는 dashboard의 **Architecture ▸ 전체** 탭
(`docs/architecture.md`) 참고.

## 런타임 구조

하나의 npm workspace(`services/order-outbox`)이지만, live-ranking처럼 api(주문 API + outbox
폴러)와 fulfillment(다운스트림 컨슈머)가 서로 다른 프로세스/포트로 뜬다. 다만 이유는
live-ranking과 다르다 — live-ranking은 두 프로세스 다 진짜 HTTP API를 갖고 있어서 분리가
자연스러웠고, 여긴 HTTP API가 api 프로세스 하나뿐이다(fulfillment는 health/metrics만). 그래도
"나중에 fulfillment가 진짜 다른 팀/서비스가 될 수 있다"는 가정 아래 처음부터 분리하는 쪽을
선택했다.

```mermaid
flowchart TB
    U["`**사용자**
    (브라우저)`"]

    subgraph API["api : 3200 — NestJS (주문 API + outbox 폴러)"]
        PANEL["`**panel.html**
        주문하기 · 3단계 상태`"]
        OAPI["`**OrdersController**
        POST/GET /orders`"]
        OSVC["`**OrdersService**
        DataSource.transaction()`"]
        PUB["`**OutboxPublisherService**
        @Interval(5초) → publishPending()`"]
        STORE["`**TypeormOutboxStore**
        markFailed → 5회째 dead 격리`"]
        DEADAPI["`**OutboxController**
        GET /outbox/dead`"]
    end

    subgraph FUL["fulfillment : 3201 — NestJS (다운스트림 컨슈머)"]
        CONS["`**OrderCreatedConsumer**
        StandardConsumer.subscribe`"]
    end

    subgraph PG["Postgres"]
        ORDERS[("`**orders**`")]
        OUTBOX[("`**outbox_records**`")]
    end

    subgraph KAFKA["Redpanda (Kafka 호환)"]
        TOPIC[("`**order.created.v1**`")]
    end

    NF[["`**node-forge**
    database · response · logger
    metrics · health`"]]
    KF[["`**kafka-forge**
    producer · consumer · outbox`"]]

    U -->|"panel.html 접속 (dashboard iframe)"| PANEL
    PANEL -->|"POST/GET (같은 오리진, CORS 불필요)"| OAPI
    OAPI --> OSVC
    OSVC -->|"트랜잭션: order+outbox insert"| ORDERS
    OSVC -.->|"같은 트랜잭션"| OUTBOX
    PUB -->|fetchPending| STORE
    STORE --> OUTBOX
    PUB -->|publish| TOPIC
    STORE -->|"markPublished / markFailed"| OUTBOX
    DEADAPI -->|listDead| STORE
    PANEL -->|"GET /outbox/dead"| DEADAPI
    TOPIC -->|subscribe| CONS
    CONS -->|"status='confirmed'"| ORDERS

    OSVC -.uses.-> NF
    PUB -.uses.-> KF
    CONS -.uses.-> KF

    classDef entryNode fill:#eef2ff,stroke:#6366f1,stroke-width:1.5px,color:#312e81
    classDef logicNode fill:#ecfdf5,stroke:#10b981,stroke-width:1.5px,color:#065f46
    classDef dbNode fill:#fff7ed,stroke:#f59e0b,stroke-width:1.5px,color:#7c2d12
    classDef kafkaNode fill:#eff6ff,stroke:#3b82f6,stroke-width:1.5px,color:#1e3a8a
    classDef forgeNode fill:#f5f3ff,stroke:#7c3aed,stroke-width:1.5px,color:#4c1d95

    class U,PANEL entryNode
    class OAPI,OSVC,PUB,STORE,CONS,DEADAPI logicNode
    class ORDERS,OUTBOX dbNode
    class TOPIC kafkaNode
    class NF,KF forgeNode
```

## API

### api (port 3200)

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/orders` | 주문 생성. `{ item, amount }` — 주문 저장과 outbox 기록을 하나의 트랜잭션으로 커밋 |
| GET | `/orders` | 최근 주문 목록. 각 항목에 `stage`(created/published/confirmed) 포함 |
| GET | `/orders/:id` | 단건 조회 |
| GET | `/outbox/dead` | dead-lettered outbox 레코드 목록/개수 — 발행 5회 연속 실패 시 격리된 레코드 확인용 |
| GET | `/health` | Postgres + Kafka 연결 상태 (5초 캐싱) |
| GET | `/metrics` | node-forge 기본 지표 + `order_outbox_orders_created_total` + kafka-forge 발행 지표 |
| GET | `/panel.html` | 패널 UI (dashboard가 iframe으로 띄움) |

### fulfillment (port 3201)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/health` | Postgres + Kafka 연결 상태 |
| GET | `/metrics` | node-forge 기본 지표 + kafka-forge 소비 지표(`kafka_forge_consumed_total`, `kafka_forge_handled_total` 등) |

fulfillment는 별도 비즈니스 API가 없다 — api가 같은 Postgres를 그대로 읽어서 주문 상태를
보여주므로 조회 API를 중복으로 둘 필요가 없다.

## DB 스키마 (Postgres, `synchronize: true`로 자동 생성 — 랩 전용, 마이그레이션 도구 없음)

| 테이블 | 주요 컬럼 | 용도 |
|---|---|---|
| `orders` | `id`(app에서 uuid 생성), `item`, `amount`, `status`(pending/confirmed), `createdAt`, `confirmedAt`(nullable, ISO 문자열) | 주문 본체. `status`/`confirmedAt`은 fulfillment가 최초 1회만 세팅(재배달돼도 안 덮어씀) |
| `outbox_records` | `id`, `topic`, `key`, `payload`(simple-json), `createdAt`, `publishedAt`(nullable, ISO 문자열), `attempts`(int, default 0), `lastError`(nullable), `deadAt`(nullable, ISO 문자열) | kafka-forge `OutboxStore` 계약. `publishedAt`이 null이면 미발행, `attempts`가 `OUTBOX_MAX_ATTEMPTS`(5)에 도달하면 `deadAt` 세팅 후 `fetchPending`에서 영구 제외(dead-letter) |

패널의 3단계(`생성됨`/`발행됨`/`확인됨`)는 두 테이블을 조합해서 계산한다 —
`orders.status`가 `confirmed`면 확인됨, 아니면 매칭되는 `outbox_records.publishedAt`이
있으면 발행됨, 없으면 생성됨. `GET /orders`, `GET /orders/:id`는 이 계산된 `stage`뿐 아니라
`publishedAt`/`confirmedAt` 실제 시각도 그대로 내려준다(아래 "폴링과 이벤트 로그" 참고).

## Kafka 토픽

| 토픽 | 용도 |
|---|---|
| `order.created.v1` | 주문 생성 이벤트. `createTopicName("order", "created", 1)`로 생성 |

## 이 실험만의 설계 결정

| 결정 | 이유 |
|---|---|
| Redis 없음 | waiting-room/live-ranking 둘 다 Redis를 썼는데, 이번엔 node-forge의 `database`(TypeORM)를 검증하는 게 목적이라 저장은 전부 Postgres로만. 멱등성도 outbox row 자체(같은 트랜잭션에 커밋)로 해결돼서 별도 Redis 멱등성 저장소가 필요 없었음 |
| id를 `@BeforeInsert()` 훅이 아니라 서비스 코드에서 직접 `randomUUID()`로 생성 | TypeORM의 라이프사이클 훅은 실제 엔티티 인스턴스에만 붙고, `manager.save(Entity, plainObject)`처럼 plain object를 그대로 저장할 때는 발동하지 않는다는 걸 테스트 중 발견 — 훅에 의존하지 않고 호출부에서 명시적으로 생성하는 쪽으로 변경 |
| `outbox_records.publishedAt`을 `Date` 컬럼이 아니라 ISO 문자열(`varchar`)로 저장 | Postgres는 `timestamp`, SQLite(테스트용)는 `datetime`만 인식하는 등 드라이버마다 타입 이름이 갈려서, 문자열로 두면 드라이버 무관하게 동일하게 동작 — 실 DB 없이 테스트로 진짜 쿼리를 검증할 수 있게 됨 |
| `payload` 컬럼은 Postgres `jsonb` 대신 `simple-json` | payload 안쪽 필드로 쿼리할 일이 없어서(항상 `key`/`publishedAt`으로만 조회), TypeORM의 `simple-json`(JSON.stringify 기반, 드라이버 무관)으로 충분 — 위와 같은 이유로 테스트 이식성도 확보 |
| vitest에서 실제 SQLite in-memory(`better-sqlite3`)로 검증 | TypeORM의 Repository/QueryBuilder API 표면이 넓어서 waiting-room/live-ranking처럼 손으로 fake DB를 만드는 대신, 실제로 초기화되는 가벼운 DB로 트랜잭션·`IsNull`·`In` 같은 진짜 동작을 검증하는 쪽을 선택 |
| 컬럼 타입을 전부 명시 (`@Column("varchar")` 등, 타입 추론 생략형 안 씀) | vitest가 쓰는 esbuild 트랜스폼은 `emitDecoratorMetadata`를 방출하지 않아서, TypeORM이 리플렉션으로 타입을 추론하는 방식의 데코레이터는 테스트 환경에서 실패함 |
| DLQ 관측성(전용 뷰어 UI) 재구현 안 함 | live-ranking에서 이미 검증된 기능이라 스코프 아웃, `StandardConsumer` 기본 재시도/DLQ만 사용 |
| `synchronize: true` | 마이그레이션 도구 없이 엔티티로 테이블 자동 생성 — 랩 환경이라 이 정도로 충분(실 서비스라면 지양해야 하는 설정임을 인지) |
| ~~(알려진 한계, 미해결)~~ kafka-forge `OutboxPublisher.publishPending()`의 배치 중 일부 실패 시 부분 재발행/영구 블로킹 | **kafka-forge 1.0.5에서 해결.** 실제로 재현(포이즌 topic row 삽입 → `produced_total`이 5초마다 중복 증가, 뒤쪽 정상 row는 영구히 미발행)한 뒤 두 건의 제안서(`proposals/kafka-forge/20260719/`)를 작성해 반영시켰다: (1) 배치 중 한 건이 실패해도 이미 성공한 건들은 계속 `markPublished`하고 다음 row로 넘어가도록 수정, (2) `OutboxStore`에 선택적 `markFailed?(id, error)` 훅 추가. 아래 두 행 참고 |
| `OUTBOX_MAX_ATTEMPTS`(5)·dead-letter 정책은 서비스가 소유, kafka-forge는 훅만 제공 | kafka-forge의 원칙("저장소 구현에 의존하지 않는다, 확장 지점은 인터페이스로만 제공") — `maxAttempts`/`markDead`를 `OutboxPublisher` 자체에 넣는 대신, `IdempotencyStore.claim`/`release`와 같은 선례를 따라 `markFailed` 훅 하나만 kafka-forge에 추가하고, "몇 번 실패하면 죽었다고 볼지"·"죽은 레코드를 어떻게 다룰지"는 전부 `TypeormOutboxStore`(이 서비스) 책임으로 뒀다 |
| dead-letter 유발을 위한 전용 테스트 트리거(`OUTBOX_POISON_ITEM`) | 임의 topic을 직접 지정할 수 있는 API를 노출하는 대신, live-ranking의 `DLQ_TEST_USER_ID` 컨벤션과 동일하게 "특정 상품명(`__outbox-fail__`)으로 주문하면 서버가 내부적으로 유효하지 않은 topic을 넣는다"는 방식으로 재현 경로를 안전하게 제한 |
| `orders.confirmedAt`은 fulfillment가 "이미 있으면 갱신 안 함" 조건으로 세팅 | 카프카 재배달로 같은 이벤트가 다시 처리돼도(핸들러 자체는 멱등이라 안전) `confirmedAt`이 재배달 시각으로 덮여쓰이면 "최초로 확인된 시각"이라는 관측 정보가 훼손된다 — `WHERE confirmedAt IS NULL` 조건으로 최초 1회만 기록 |
| 패널 이벤트 로그는 폴링 snapshot이 아니라 서버가 내려주는 `publishedAt`/`confirmedAt` 실제 시각으로 재구성 | outbox 폴링 간격(5초)에 비해 발행→소비(카프카 컨슈머 반응)는 보통 수십~수백ms 안에 끝나서, 패널의 1초 폴링이 "발행됨" 상태를 거의 항상 놓친다(실측: 발행 12ms 뒤 확인됨). "지금 상태가 뭐냐"만 폴링해서 전이를 로그로 남기면 중간 단계가 통째로 빠질 수 있어서, 서버가 실제 발행/확인 시각을 함께 내려주고 클라이언트는 그 시각 기준으로 로그를 재구성한다 — 폴링 방식 자체는 그대로 두고(waiting-room/live-ranking과 동일 컨벤션), 폴링이 실어오는 정보만 풍부하게 만든 것 |

## 검증 이력 (2026-07-19)

- `docker compose up --build -d`로 4개 컨테이너(api, fulfillment, postgres, redpanda) 기동 —
  Postgres가 아직 안 떴을 때의 일시적 `ECONNREFUSED`는 `restart: unless-stopped`로 자연스럽게
  복구됨(live-ranking의 redpanda 초기 기동 지연과 같은 패턴)
- `POST /orders`로 주문 생성 → 즉시 `stage: "created"` 확인 → 약 12초 후 `stage: "confirmed"`로
  전환된 것 확인(outbox 폴러 발행 → fulfillment 컨슈머 반영까지 실제로 재현)
- `order_outbox_orders_created_total`(api), `kafka_forge_produced_total`(api),
  `kafka_forge_consumed_total`/`kafka_forge_handled_total`(fulfillment) 지표가 모두 1로
  정확히 찍히는 것 확인
- panel.html 정상 서빙 확인
- vitest 15개(이벤트 스키마 5, TypeormOutboxStore 4, OrdersService 6) 전부 통과 — 실제
  SQLite in-memory DB로 트랜잭션/조회 로직까지 검증

### 후속 (2026-07-19) — 이벤트 로그가 "발행됨"을 건너뛰던 문제

실제 사용자 테스트에서 "발행됨을 안 거치고 바로 확인됨으로 넘어간다"는 리포트 발견. 원인은
버그가 아니라 폴링 주기(1초)보다 발행→소비 지연이 훨씬 짧아서(실측 12ms) 패널이 그 상태를
관측할 기회 자체가 거의 없었던 것 — 폴링 방식 자체는 유지하고, 서버가 실제 시각을
같이 내려주도록 고쳤다.

- `entities/order.entity.ts` — `confirmedAt`(nullable, ISO 문자열) 추가
- `fulfillment/order-created.consumer.ts` — `confirmedAt`을 `WHERE confirmedAt IS NULL`
  조건으로 최초 1회만 세팅
- `api/orders.service.ts` — `OrderView`에 `publishedAt`/`confirmedAt` 노출
- `public/panel.html` — 이벤트 로그를 poll snapshot 비교 대신 `publishedAt`/`confirmedAt`
  존재 여부 + "이미 로그로 남긴 전이인지" 추적(`loggedTransitions`)으로 재작성, 로그 시각도
  `new Date()`가 아니라 실제 전이 시각으로 표시
- `orders.service.test.ts` — publishedAt/confirmedAt 노출 검증 추가

**검증**: 주문 생성 → 8초 후 조회 시 `publishedAt`/`confirmedAt`이 실제 값으로 채워지는 것
확인(예시: 발행 08:57:29.108 → 확인 08:57:29.120, 12ms 차이). panel.html 반영 확인, vitest
15개 유지하며 통과.

### 후속 (2026-07-19) — kafka-forge 1.0.5 채택: outbox 부분 실패/영구 블로킹 수정 + dead-lettering

"냉정하게 평가해달라"는 요청으로 `OutboxPublisher.publishPending()` 소스를 읽다가 발견한 버그를
직접 재현: `docker exec ... psql`로 정상 row 1건 → 독성 topic row 1건 → 정상 row 1건을 순서대로
삽입하고 api 컨테이너를 재시작해서 관찰한 결과,

- `kafka_forge_produced_total`이 40초 동안 5씩 증가 — 앞쪽 정상 row가 5초마다 **중복 발행**됨
  (배치 중 하나가 실패하면 그 이전에 이미 성공한 것도 `markPublished`가 호출되지 않고 예외가
  던져졌기 때문)
- `kafka_forge_produce_errors_total{topic="invalid topic name!!!"}`이 9까지 무한정 증가 —
  재시도 제한 없음
- 세 번째(뒤쪽) 정상 row는 테스트 기간 내내 `publishedAt`이 계속 null — 독성 row에 **영구히
  막힘**(head-of-line blocking)

이걸 근거로 두 건의 제안서를 작성해 알렸고, 사용자가 kafka-forge 1.0.5로 반영:
- `20260719-outbox-publisher-partial-failure.md` — 배치 처리 루프가 개별 row 실패에 더 이상
  `throw`하지 않고 로그만 남긴 채 계속 진행, 이미 성공한 건은 항상 `markPublished`
- `20260719-outbox-store-mark-failed-hook.md` — `OutboxStore`에 선택적 `markFailed?(id, error)`
  훅 추가 (정책은 전부 구현체 책임)

이 서비스 쪽 구현:
- `entities/outbox-record.entity.ts` — `attempts`(int, default 0), `lastError`(nullable),
  `deadAt`(nullable, ISO 문자열) 컬럼 추가
- `api/typeorm-outbox-store.ts` — `markFailed(id, error)`(5회째 `deadAt` 세팅), `listDead(limit)`
  구현, `fetchPending`에서 `deadAt IS NULL` 조건 추가
- `api/outbox.controller.ts` — `GET /outbox/dead` 신규
- `api/orders.service.ts` — `item === OUTBOX_POISON_ITEM`이면 outbox row의 topic을 일부러
  유효하지 않은 문자열(`OUTBOX_POISON_TOPIC`)로 저장
- `public/panel.html` — "죽은 outbox 레코드" 카드(개수 + 목록) + "발행 실패 유발" 버튼 추가
- 테스트 3건 추가(반복 실패 시 유지/5회째 dead 전이/존재하지 않는 id 무시) — 총 19개, 전부 통과

**검증(2026-07-19, `docker compose up --build -d` 후 실제 컨테이너 대상)**: 사전 정상 주문 →
포이즌 주문(`__outbox-fail__`) → 사후 정상 주문 순서로 3건 생성 후 25초 대기(5초 간격 ×
`OUTBOX_MAX_ATTEMPTS`=5회) 결과,
- 사전 주문: `stage: "confirmed"` 정상
- 포이즌 주문: `stage: "created"`로 영구 고정(정상 동작), `GET /outbox/dead`에
  `attempts: 5`, `lastError: "The request attempted to perform an operation on an invalid
  topic"`, `deadAt` 세팅된 것 확인
- **사후 주문도 `stage: "confirmed"`로 정상 처리** — 포이즌 레코드에 더 이상 막히지 않음(수정 전
  버그였던 영구 블로킹 해소 확인)
- `kafka_forge_produced_total{topic="order.created.v1"}` = 2 (사전+사후, 중복 없음),
  `kafka_forge_produce_errors_total{topic="invalid topic name!!!"}` = 5 (정확히
  `OUTBOX_MAX_ATTEMPTS`에서 멈추고 더 이상 증가하지 않음 — 무한 재시도 해소 확인)

테스트 데이터는 검증 후 `TRUNCATE orders, outbox_records`로 정리.

관련 플랜: `.claude-plans/20260719/order-outbox-pipeline.md` (실행 이력 포함).
