# live-ranking 아키텍처

이벤트 기반 실시간 랭킹 서버. forge-lab의 두 번째 실험이며, waiting-room이 검증하지 않은
**kafka-forge**(producer/consumer/재시도/DLQ/멱등성 확장점)를 node-forge의 Redis ZSET 랭킹
헬퍼와 함께 검증한다. 레포 전체 구조는 dashboard의 **Architecture ▸ 전체** 탭
(`docs/architecture.md`) 참고, 여기서는 이 실험 내부만 다룬다.

## 런타임 구조

하나의 npm workspace(`services/live-ranking`)이지만, producer와 consumer가 서로 다른 포트의
독립된 프로세스로 뜬다 — 같은 이미지를 빌드하고 `docker-compose.yml`의 `command:`만 다르게
지정한다.

```mermaid
flowchart TB
    U["`**사용자**
    (브라우저)`"]

    subgraph ING["ingest : 3100 — NestJS (producer)"]
        IAPI["`**IngestController**
        POST /leaderboards/:id/events`"]
        PROD["`**ScoreEventProducerService**
        StandardProducer.send`"]
    end

    subgraph AGG["aggregator : 3101 — NestJS (consumer + 조회)"]
        PANEL["`**panel.html**
        랭킹 그리드 · 이벤트 시뮬레이션`"]
        CONS["`**ScoreEventConsumer**
        StandardConsumer.subscribe
        재시도/DLQ는 kafka-forge가 자체 처리`"]
        IDEM["`**RedisIdempotencyStore**
        eventId 기준 dedup`"]
        RAPI["`**RankingController**
        top / users/:id / reset`"]
        RSVC["`**RankingService**
        zincrby · getTopN · getRankAndScore`"]
    end

    subgraph KAFKA["Redpanda (Kafka 호환)"]
        TOPIC[("`**ranking.score-events.v1**`")]
        DLQ[("`**...v1.dlq**
        재시도 소진 시 자동 이동`")]
    end

    subgraph REDIS["Redis"]
        ZSET[("`**ranking:{leaderboardId}**
        ZSET, score=누적 점수`")]
        IDEMKEY[("`**idempotency:score-event:***
        TTL 1시간`")]
    end

    NF[["`**node-forge**
    redis · response · logger
    metrics · health`"]]
    KF[["`**kafka-forge**
    producer · consumer · idempotency`"]]

    U -->|"panel.html 접속 (dashboard iframe)"| PANEL
    U -.->|"POST (CORS, panel과 다른 오리진)"| IAPI
    PANEL -.->|"이벤트 발행 fetch"| IAPI
    PANEL -->|"fetch (같은 오리진)"| RAPI

    IAPI --> PROD
    PROD -->|send| TOPIC
    TOPIC -->|subscribe| CONS
    CONS -->|"wasProcessed/markProcessed"| IDEM
    IDEM -->|"get/set"| IDEMKEY
    CONS -->|"재시도 소진"| DLQ
    CONS --> RSVC
    RSVC -->|"zincrby"| ZSET
    RAPI --> RSVC
    RSVC -->|"getTopN/getRankAndScore"| ZSET

    PROD -.uses.-> KF
    CONS -.uses.-> KF
    IAPI -.uses.-> NF
    RSVC -.uses.-> NF

    classDef entryNode fill:#eef2ff,stroke:#6366f1,stroke-width:1.5px,color:#312e81
    classDef logicNode fill:#ecfdf5,stroke:#10b981,stroke-width:1.5px,color:#065f46
    classDef redisNode fill:#fff7ed,stroke:#f59e0b,stroke-width:1.5px,color:#7c2d12
    classDef kafkaNode fill:#eff6ff,stroke:#3b82f6,stroke-width:1.5px,color:#1e3a8a
    classDef forgeNode fill:#f5f3ff,stroke:#7c3aed,stroke-width:1.5px,color:#4c1d95

    class U,PANEL entryNode
    class IAPI,PROD,CONS,IDEM,RAPI,RSVC logicNode
    class ZSET,IDEMKEY redisNode
    class TOPIC,DLQ kafkaNode
    class NF,KF forgeNode
```

## API

### ingest (port 3100)

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/leaderboards/:leaderboardId/events` | 점수 이벤트 발행. `{ userId, delta, eventId? }` — `eventId`를 생략하면 서버가 매번 새로 발급(HTTP 재시도 자체의 멱등성은 스코프 밖) |
| GET | `/health` | Kafka 브로커 연결 상태 |
| GET | `/metrics` | node-forge 기본 HTTP 지표 + kafka-forge 발행 지표(`kafka_forge_produced_total` 등, `registerMetricsInto`로 합류) |

### aggregator (port 3101)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/leaderboards/:leaderboardId/top?limit=20` | 상위 N명 (1-based rank 포함) |
| GET | `/leaderboards/:leaderboardId/users/:userId` | 특정 유저의 순위/점수. 참가 안 했으면 둘 다 `null` |
| DELETE | `/leaderboards/:leaderboardId` | 리더보드 초기화 (테스트/데모 전용) |
| GET | `/health` | Redis + Kafka 브로커 연결 상태 |
| GET | `/metrics` | node-forge 기본 지표 + `live_ranking_score_events_applied_total` + kafka-forge 소비 지표(`kafka_forge_consumed_total`, `kafka_forge_consumer_lag`, `kafka_forge_deduped_total` 등, `registerMetricsInto`로 합류) |
| GET | `/panel.html` | 실시간 랭킹 패널 UI (dashboard가 iframe으로 띄움) |

## Redis 키 스키마

| 키 | 타입 | 용도 |
|---|---|---|
| `ranking:{leaderboardId}` | ZSET | member=`userId`, score=누적 점수(`zincrby`) |
| `idempotency:score-event:{eventId}` | STRING (TTL 1시간) | consumer가 이 이벤트를 이미 처리했는지 기록 |

## Kafka 토픽

| 토픽 | 용도 |
|---|---|
| `ranking.score-events.v1` | 점수 이벤트. `createTopicName("ranking", "score-events", 1)`로 생성 — 직접 문자열 하드코딩 안 함 |
| `ranking.score-events.v1.dlq` | 재시도(기본 3회) 소진 시 kafka-forge `StandardConsumer`가 자동으로 이동시킴 |

## 이 실험만의 설계 결정

| 결정 | 이유 |
|---|---|
| producer(ingest)와 consumer(aggregator)를 같은 npm workspace, 다른 프로세스/포트로 분리 | "producer/consumer가 같은 포트를 쓰는 게 이상하다"는 판단에 따라 진짜 분리된 프로세스로 검증하면서도, dashboard 입장에서는 여전히 실험 하나(탭 하나)로 다룬다. Dockerfile은 하나만 만들고 `docker-compose.yml`의 `command:`로만 구분 |
| 멱등성 저장소를 Redis로 직접 구현(`RedisIdempotencyStore`) | kafka-forge는 `IdempotencyStore` 인터페이스만 제공하고 구현은 소비 서비스 책임으로 둔다(저장소 비의존 원칙). 기본 제공되는 `InMemoryIdempotencyStore`는 프로세스 재시작 시 초기화되어 "consumer 크래시 후 재시작 → 재배달"에서는 dedup을 못 한다 — Redis에 저장해 재시작을 넘어서도 dedup이 유지되는 걸 실제로 확인함(아래 검증 참고) |
| dedupeKey를 `eventId`로 지정 (기본값인 `topic:partition:offset` 대신) | offset 기준 dedup은 재처리 시 offset이 달라지면 무력화된다. 비즈니스 키(eventId)로 지정해야 "같은 이벤트"를 진짜로 식별한다 |
| 재시도/DLQ는 커스텀 구현 없이 kafka-forge `StandardConsumer` 기본값 사용 | 이미 재시도(3회, 지수 backoff)와 DLQ 이동을 자체 제공하므로 직접 만들 이유가 없음 — kafka-forge를 실사용 검증하는 게 이 실험의 목적이기도 함 |
| 랭킹 로직에 node-forge 제안서 불필요 | `zincrby`/`zrevrank`/`getTopN`/`getRankAndScore`가 이미 1.0.3에 존재 — waiting-room 때 발견한 `zadd` NX/XX 갭과 달리 이번엔 갭이 없었음 |
| partitionKey = `leaderboardId` | 같은 리더보드의 이벤트를 같은 파티션에 모아, 파티션 단위 관측(consumer lag 등)이 리더보드 단위로 단순해짐 |
| producer는 `idempotent: true, maxInFlightRequests: 1` | kafkajs/브로커 레벨에서 네트워크 재시도로 인한 중복 발행을 막는다. eventId 기반 dedup(consumer 쪽)과는 다른 계층의 멱등성 |
| `/metrics` 하나로 통합 (kafka-forge 1.0.2) | 처음엔 node-forge `MetricsModule.forRoot()`의 `/metrics`와 kafka-forge의 별도 레지스트리(`kafka_forge_*`)를 합칠 방법이 없어 `/metrics/kafka`로 따로 노출했다. kafka-forge에 `registerMetricsInto(registry)` 추가를 제안(`proposals/kafka-forge/20260717-metrics-registry-merge.md`) → 1.0.2에 반영되어 `main.ts`에서 `registerMetricsInto(forgeMetrics.registry)` 한 번 호출로 통합, `/metrics/kafka` 컨트롤러는 제거 |
| 멱등성 스킵 카운터는 kafka-forge 표준 지표 사용 (kafka-forge 1.0.2) | 처음엔 `RedisIdempotencyStore.wasProcessed()` 안에서 직접 카운터를 증가시켰으나, 구현체마다 지표 이름이 달라지면 서비스 간 비교가 어렵다고 판단해 `kafka_forge_deduped_total` 추가를 제안(`proposals/kafka-forge/20260717-consumer-dedup-metric.md`) → 1.0.2에 반영되어 `StandardConsumer`가 자체적으로 잡아주므로 자체 카운터(`scoreEventsDeduped`)는 제거 |
| vitest로 핵심 로직(랭킹 반영/조회/리셋, 멱등성 저장소, 이벤트 스키마)에 유닛테스트 | 실제 Redis/Kafka 없이 `ForgeRedisClient`의 필요한 메서드만 인메모리로 구현한 fake로 검증 (waiting-room과 동일 패턴) |

## 검증 이력 (2026-07-17)

- `docker compose up --build -d`로 4개 컨테이너(ingest, aggregator, redis, redpanda) 기동 —
  kafkajs의 내부 재시도로 redpanda 초기 기동 지연을 자연스럽게 견딤(별도 healthcheck 불필요,
  안전망으로 `restart: unless-stopped`만 추가)
- curl로 이벤트 발행 → 2초 내 `/top`/`/users/:id`에 반영되는 것 확인
- 같은 `eventId`로 2회 발행 → 점수가 한 번만 반영되는 것으로 멱등성 확인
- aggregator 컨테이너를 재기동해도(재배달 시나리오와 동일한 상황) Redis에 저장된 리더보드
  점수와 멱등성 키가 그대로 유지되는 것 확인 — `InMemoryIdempotencyStore`로는 불가능했을 지점
- panel.html의 cross-origin 이벤트 발행(ingest CORS) 정상 동작 확인
- vitest 19개 전부 통과

### 후속 (2026-07-17) — kafka-forge 1.0.2 반영

`proposals/kafka-forge/20260717/` 두 건이 kafka-forge 1.0.2로 반영되어, 로컬 우회를 걷어내고
공식 API로 되돌렸다.

- `@paikpaik/kafka-forge` `^1.0.0` → `^1.0.2`
- `main.ts`(ingest/aggregator 둘 다)에서 `registerMetricsInto(forgeMetrics.registry)` 호출 추가,
  `KafkaMetricsController`(`/metrics/kafka`)와 그 라우트 등록 삭제
- `RankingMetrics.scoreEventsDeduped`, `RedisIdempotencyStore`의 수동 카운터 증가 코드 삭제
  (`kafka_forge_deduped_total`로 대체)
- 검증: `GET /metrics/kafka`가 404로 사라지고, `GET /metrics` 하나에 `kafka_forge_*`와
  `live_ranking_*` 지표가 함께 나오는 것 확인. 같은 `eventId` 중복 발행 시 점수는 유지되고
  `kafka_forge_deduped_total`이 정확히 증가하는 것 확인. vitest 18개(카운터 중복 테스트
  1건 제거) 전부 통과

관련 플랜: `.claude-plans/20260717/live-ranking-event-pipeline.md` (실행 이력 포함).
