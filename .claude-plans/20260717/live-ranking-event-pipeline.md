## 플랜 실행 이력

### 후속: 2026-07-19 (DLQ 관측성 확보)

냉정한 분석에서 발견한 MEDIUM 이슈 중 마지막으로 남아있던 걸 처리 — "재시도 소진된 이벤트를
아무도 볼 방법이 없다."

**실제 변경 파일**:
- `src/shared/score-event.contract.ts` — `ScoreEventDlq`(`EventContract` 리터럴로 `defineEvent()`
  우회), `DlqEnvelopeSchema` 추가
- `src/aggregator/dlq-log.service.ts`, `dlq.controller.ts`, `score-event-dlq.consumer.ts` — 신규
- `src/aggregator/score-event.consumer.ts` — `DLQ_TEST_USER_ID` 포이즌 필 훅 추가
- `src/aggregator/aggregator.module.ts` — 위 3개 신규 provider/controller 등록
- `public/panel.html` — "DLQ (실패한 이벤트)" 카드 + 버튼 2개
- `src/test-utils/fake-redis-client.ts` — `lpush`/`lrange`/`llen` 추가
- `src/aggregator/dlq-log.service.test.ts` — 신규 3건
- `ARCHITECTURE.md` — mermaid에 DLQ consumer 노드 추가, API/키/토픽 표, 설계 결정 갱신

**계획과의 차이**: 없음. 다만 구현 중 발견 — `toDlqTopicName()`이 만든 토픽명은 kafka-forge
자신의 네이밍 컨벤션을 어겨서 `defineEvent()`를 못 쓴다는 걸 알게 됨 → `EventContract`를
리터럴로 직접 구성해서 우회(제안서 없이 해결 가능한 수준이라 별도 proposal 없음).

**검증**: `__dlq-test__` userId로 이벤트 발행 → 실제로 재시도 3회 소진 → DLQ 이동 →
`live-ranking-dlq-viewer` 컨슈머가 픽업 → `GET /dlq`에 정확한 내용으로 기록되는 것까지
end-to-end로 재현 확인(이전 claim 검증 때와 달리 이번엔 타이밍 문제 없이 실제로 전체
경로를 재현할 수 있었음). vitest 24개 전부 통과.

**잔존 작업**: 냉정한 분석에서 나온 항목 전부 처리 완료(HIGH: claim, MEDIUM: 패널 멱등성
시연, MEDIUM: DLQ 관측성). LOW 2건(delta 상/하한 미검증, 헬스체커 연결 재사용 안 함)은
미착수 — 필요해지면 별도 요청.

---

### 후속: 2026-07-18 (kafka-forge 1.0.3 반영 — claim으로 크래시 윈도우 제거)

`proposals/kafka-forge/20260717-idempotency-claim-before-effect.md`가 1.0.3으로 반영됨.

**실제 변경 파일**:
- `package.json` — `@paikpaik/kafka-forge` `^1.0.2` → `^1.0.3`
- `src/aggregator/redis-idempotency-store.ts` — `claim(key)` 추가, node-forge
  `ForgeRedisClient.lock()`(기존 SET NX PX 분산 락) 재사용. `wasProcessed`/`markProcessed`는
  인터페이스 호환용으로 남김(더 이상 `StandardConsumer`가 호출하지 않음)
- `src/test-utils/fake-redis-client.ts` — `lock()` 흉내 추가
- `src/aggregator/redis-idempotency-store.test.ts` — `claim` 원자성 테스트 3건 추가
- `ARCHITECTURE.md`, `docs/issues.md` — 반영 내용 문서화

**계획과의 차이**: 없음 — 제안서에 적어둔 API(`claim(key): Promise<boolean>`) 그대로 반영됨.

**검증**: Docker 재빌드 후 기본 멱등성 스모크(같은 eventId 2회 발행 → 점수 유지) 재확인,
vitest 21개 전부 통과. **한계**: 원래 버그였던 "크래시가 정확히 이펙트 적용 후 마킹 전에
나는" 타이밍은 외부에서 재현하기 어려워 실제로 프로세스를 그 순간에 죽여보는 테스트는
안 했음 — `claim`의 원자성 계약(유닛 테스트)과 kafka-forge 소스의 실제 호출 순서 확인으로
대신함.

**잔존 작업**: DLQ 관측성 문제(냉정한 분석에서 발견, MEDIUM)는 여전히 미착수.

---

### 후속: 2026-07-17 (냉정한 분석 → kafka-forge 제안서 → 패널 개선)

사용자가 "냉정하게 live-ranking 패널을 바라보고 개선점이 있는지" 요청 — waiting-room 때와
같은 패턴으로 코드를 다시 읽으며 검토했다.

**발견한 것**:
- HIGH — `StandardConsumer.processMessage()`가 "체크 → 이펙트 적용 → 마킹" 순서라, 이펙트
  적용 후 마킹 전에 크래시/컨슈머 그룹 리밸런스가 나면 재배달 시 중복 반영됨. `IdempotencyStore`
  구현으로는 못 막는, 라이브러리 호출 순서 자체의 문제
- MEDIUM — 패널의 봇 시뮬레이션/+10점 버튼이 매번 새 `eventId`를 써서, 이 실험의 핵심(멱등성)을
  UI로는 전혀 검증할 수 없었음
- MEDIUM — DLQ로 넘어간 이벤트를 확인할 관측 수단이 없음 (이번 회차에서는 미착수, 범위 밖)
- LOW — delta 상/하한 미검증, 헬스체커가 호출마다 Kafka Admin 연결을 새로 엶

**실제 변경 파일**:
- `proposals/kafka-forge/20260717/20260717-idempotency-claim-before-effect.md` — 신규.
  `IdempotencyStore`에 이펙트 적용 "전" 원자적 선점(`claim`) 옵션 추가 제안. `RedisIdempotencyStore`
  구현은 node-forge `ForgeRedisClient.lock()`(기존 SET NX PX 분산 락)을 그대로 재사용하면
  돼서 node-forge 쪽 제안서는 불필요
- `public/panel.html` — "멱등성 확인" 카드 추가("같은 이벤트 두 번 보내기" 버튼), `delay()`/
  `fetchUserRank()` 헬퍼 추가, 가이드 문구를 devtools 안내에서 버튼 안내로 수정, `/metrics/kafka`
  참조를 `/metrics`로 정정(이전 회차에서 통합됐는데 가이드 텍스트가 안 갱신돼 있던 것도 같이 고침)
- `ARCHITECTURE.md` — 설계 결정 표에 패널 개선 항목과 "미해결" 멱등성 순서 문제 추가

**계획과의 차이**: 없음 — 사용자가 승인한 순서(제안서 작성 → 패널 버튼 추가) 그대로 진행.

**검증**: Docker 재빌드 후 panel.html에 새 버튼 반영 확인(`grep -c`). curl로 같은 eventId 2회
발행 → 점수 유지(15점 → 15점), `kafka_forge_deduped_total` 증가 확인.

**잔존 작업**: kafka-forge `claim` 제안은 아직 미반영(사용자가 실제 배포하면 이전처럼 로컬
우회 걷어내고 반영 예정). DLQ 관측성 문제는 이번 회차에서 다루지 않음 — 필요해지면 별도 작업으로.

---

### 후속: 2026-07-17 (kafka-forge 1.0.2 반영, 로컬 우회 제거)

개발 중 발견한 두 가지 관측성 gap(멱등성 스킵 카운터 없음, 지표 레지스트리 병합 불가)을
`proposals/kafka-forge/20260717/`에 정리해뒀는데, 사용자가 kafka-forge를 1.0.2로 배포함
(1.0.1은 배포가 스킵되고 1.0.2로 바로 반영됨). 곧바로 반영해서 로컬 우회를 걷어냈다.

**실제 변경 파일**:
- `package.json` — `@paikpaik/kafka-forge` `^1.0.0` → `^1.0.2`
- `src/ingest/main.ts`, `src/aggregator/main.ts` — `registerMetricsInto(forgeMetrics.registry)`
  호출 추가
- `src/shared/kafka-metrics.controller.ts` — 삭제, `ingest.module.ts`/`aggregator.module.ts`의
  컨트롤러 목록에서도 제거 (`/metrics/kafka` 엔드포인트가 이제 `/metrics` 하나로 합쳐짐)
- `src/aggregator/ranking.metrics.ts` — `scoreEventsDeduped` 카운터 제거
- `src/aggregator/redis-idempotency-store.ts` — `RankingMetrics` 의존성 및 수동 카운터 증가 제거
  (`kafka_forge_deduped_total`로 대체)
- `src/aggregator/redis-idempotency-store.test.ts` — 카운터 검증 테스트 1건 제거
- `ARCHITECTURE.md`, `docs/issues.md` — 반영 내용 문서화

**계획과의 차이**: 없음 — 애초에 제안서에 적어둔 API 형태(`registerMetricsInto(registry)`,
`kafka_forge_deduped_total{topic,group}`) 그대로 반영됨.

**검증**: `docker compose up --build -d` 재빌드 → `GET /metrics/kafka`가 404로 사라지고
`GET /metrics` 하나에 `kafka_forge_*`/`live_ranking_*` 지표가 함께 노출되는 것 확인. 같은
`eventId`로 중복 발행해도 점수는 유지되고 `kafka_forge_deduped_total`이 정확히 1 증가하는
것 확인. vitest 18개(19개 중 카운터 중복 테스트 1건은 자연 소멸) 전부 통과.

**잔존 작업**: 없음.

---

### 완료: 2026-07-17

**결과**: 성공

**실제 변경 파일**:
- `services/live-ranking/package.json`, `tsconfig.json`, `.npmrc`, `.env` — 스캐폴딩(waiting-room 컨벤션 그대로)
- `src/shared/score-event.contract.ts` — `defineEvent`로 토픽/스키마/partitionKey 한 곳에 정의
- `src/shared/constants.ts` — 키 스키마, KAFKA_INSTANCE 토큰, TTL 등
- `src/shared/kafka-health.ts` — node-forge `HealthChecker` 인터페이스를 카프카용으로 직접 구현(제안서 불필요, 인터페이스 규약만 따르면 되는 경우)
- `src/shared/kafka-metrics.controller.ts` — kafka-forge `metricsRegistry`를 `/metrics/kafka`로 별도 노출
- `src/ingest/*` — producer 프로세스(포트 3100): `IngestController`, `ScoreEventProducerService`(StandardProducer), `KafkaClientModule`(@Global), `IngestAppModule`, `main.ts`(CORS 활성화)
- `src/aggregator/*` — consumer+조회 프로세스(포트 3101): `RankingController`, `RankingService`, `RankingMetrics`, `RedisIdempotencyStore`(IdempotencyStore를 Redis로 구현), `ScoreEventConsumer`(StandardConsumer), `KafkaClientModule`, `AggregatorAppModule`, `main.ts`
- `public/panel.html` — 랭킹 그리드 + 8개 봇 이벤트 시뮬레이션 + 내 점수 참가
- `Dockerfile`(이미지 1개), `docker-compose.yml`(ingest/aggregator/redis/redpanda 4서비스, command로만 구분), `forge-lab.json`
- vitest 3개 파일(19 테스트): `ranking.service.test.ts`, `redis-idempotency-store.test.ts`, `score-event.contract.test.ts`, `test-utils/fake-redis-client.ts`
- `ARCHITECTURE.md` — 신규

**계획과의 차이**:
- Dockerfile을 `Dockerfile.ingest`/`Dockerfile.aggregator` 둘로 나누려던 초안 대신, 이미지 하나 + `docker-compose.yml`의 `command:`로 진입점만 다르게 지정하는 방식으로 단순화(중복 제거).
- 구현 중 두 가지 실제 버그를 고침: (1) `aggregator/main.ts`가 `dist/aggregator/main.js`로 한 단계 더 들어가 있는데 `useStaticAssets(join(__dirname, "..", "public"))`를 waiting-room 그대로 복사해서 `panel.html`이 404였음 — `"..", ".."`로 수정. (2) DTO의 `@IsUUID()`가 임의 16진수 문자열("1111...")을 v4 UUID로 인식하지 못해 400이 남 — 테스트 시 `crypto.randomUUID()`로 교체(코드 버그는 아니고 검증 스크립트 쪽 실수).
- redpanda 기동 지연 대비용 헬스체크(rpk 기반)는 만들지 않고 `restart: unless-stopped` + kafkajs 자체 재시도로 충분함을 실측 확인(불필요한 복잡도 제거).

**잔존 작업**:
- 없음 — 계획된 5단계(스캐폴딩/ingest/aggregator/panel+Docker/테스트+검증) 전부 완료, node-forge/kafka-forge 대상 제안서도 발생하지 않음(둘 다 필요한 API가 이미 존재).

---

# live-ranking-event-pipeline — 이벤트 기반 실시간 랭킹 서버 (두 번째 실험)

## 목표

forge-lab의 두 번째 실험. waiting-room이 node-forge(redis/response/logger/metrics/health)를 검증했다면,
이번엔 지금까지 전혀 안 건드려본 **kafka-forge**를 실사용 검증한다. 점수 이벤트를 Kafka로 수집(producer)
하고 별도 프로세스가 구독(consumer)해서 Redis ZSET 랭킹에 반영하는 구조로, kafka-forge의
producer/consumer/재시도/DLQ/멱등성 확장점과 node-forge의 랭킹 헬퍼(zincrby, zrevrank, getTopN 등)를
함께 검증한다.

## 현재 상태 (AS-IS)

- `services/waiting-room`만 존재. Redis ZSET을 대기열 용도로 쓰지만 Kafka는 전혀 안 씀.
- `@paikpaik/kafka-forge`는 forge-lab에서 한 번도 설치/사용된 적 없음. GitHub Packages에는
  `v1.0.0`이 실제로 배포되어 있음(확인 완료 — `npm view @paikpaik/kafka-forge versions` 성공).
- `forge/kafka-forge`(참고 클론) 확인 결과 핵심 API:
  - `createTopicName(domain, event, version)` → `<domain>.<event>.v<N>` 형식 강제
  - `defineEvent({ topic, schema(zod), partitionKey })` — 토픽/스키마/파티션키를 한 곳에서 정의
  - `StandardProducer.send(event, payload)` — zod 검증 후 발행
  - `StandardConsumer.subscribe(event, handler, { retry, idempotencyStore, dedupeKey }).run()` —
    **재시도(기본 3회, backoff)와 DLQ(`<topic>.dlq`)를 이미 자체 구현하고 있음** → 직접 구현할 필요 없음
  - `IdempotencyStore` 인터페이스만 제공, 구현은 소비 서비스 책임(`InMemoryIdempotencyStore`는
    학습/데모용, 재시작하면 초기화됨 — 프로세스 재시작을 넘는 멱등성엔 부적합)
- `forge/node-forge`(참고 클론, v1.0.3 = 현재 설치 버전) 확인 결과 **랭킹에 필요한 메서드가 이미 다 있음**:
  `zincrby`, `zrevrank`, `zrevrange`/`zrevrangeWithScores`, `getTopN`, `getRankAndScore` — 별도 제안서 불필요.

## 변경 후 상태 (TO-BE)

```
services/live-ranking/                     ← npm workspace 하나 = dashboard 탭 하나
├── src/
│   ├── ingest/                            producer 프로세스 (port 3100)
│   │   ├── main.ts
│   │   ├── ingest.module.ts
│   │   ├── ingest.controller.ts           POST /leaderboards/:id/events
│   │   ├── ingest.producer.service.ts     StandardProducer 래핑 (OnModuleInit connect)
│   │   └── dto/submit-score-event.dto.ts
│   ├── aggregator/                        consumer + 조회 API 프로세스 (port 3101)
│   │   ├── main.ts
│   │   ├── aggregator.module.ts
│   │   ├── ranking.controller.ts          GET /leaderboards/:id/top, /users/:userId, DELETE
│   │   ├── ranking.service.ts             Redis ZSET (zincrby/getTopN/getRankAndScore)
│   │   ├── score-event.consumer.ts        StandardConsumer 구독 (OnModuleInit)
│   │   └── redis-idempotency-store.ts     IdempotencyStore를 ForgeRedisClient로 구현
│   └── shared/
│       ├── score-event.contract.ts        defineEvent(topic, zod schema, partitionKey)
│       └── constants.ts                   leaderboardKey() 등
├── public/panel.html                      aggregator가 서빙 — 랭킹 그리드 + 이벤트 발사 버튼
├── test-utils/ (fake-redis-client, fake-kafka 유사 패턴 — waiting-room 컨벤션 재사용)
├── Dockerfile                             하나의 이미지, compose에서 command만 다르게 지정
├── docker-compose.yml                     redis + redpanda(kafka) + ingest + aggregator
├── forge-lab.json                         { "panelUrl": "http://localhost:3101/panel.html" }
├── package.json / tsconfig.json
└── ARCHITECTURE.md
```

### 토픽/이벤트 설계

- 토픽명: `createTopicName("ranking", "score-events", 1)` → `ranking.score-events.v1`
- 스키마: `{ eventId(uuid), leaderboardId, userId, delta(int) }`
- partitionKey: `leaderboardId` (같은 리더보드 이벤트는 같은 파티션 → 관측이 단순해짐)
- dedupeKey(멱등성 키): `eventId` — 기본값인 `topic:partition:offset`이 아니라 비즈니스 키로 지정.
  offset 기준으로 하면 재처리 시 offset이 달라져 dedup이 무력화될 수 있음
- 멱등성 저장소: `RedisIdempotencyStore`(신규) — `ForgeRedisClient.set(key, "1", ttlSec)` +
  `get`으로 `wasProcessed`/`markProcessed` 구현. 프로세스 재시작에도 살아남아야 크래시 후
  재배달 시 중복 집계를 실제로 막을 수 있음(`InMemoryIdempotencyStore`로는 못 막는 지점)
- 재시도/DLQ: kafka-forge 기본값(3회, 1000ms 지수 backoff) 그대로 사용, 소진 시
  `ranking.score-events.v1.dlq`로 자동 이동 — 커스텀 구현 없음

### 포트/인프라

- ingest: 3100 (Kafka producer만 필요, Redis 불필요)
- aggregator: 3101 (Kafka consumer + Redis + 조회 API + panel.html + /health + /metrics)
- redis: 컨테이너 내부만 사용(호스트 노출 없음, waiting-room의 6379와 별개 인스턴스)
- redpanda(Kafka 호환): 호스트 포트 29092(카프카 프로토콜) — kafka-forge 참고 compose의
  19092와 겹치지 않게 별도 포트 사용

## 변경 범위

| 파일 | 변경 내용 |
|------|----------|
| `services/live-ranking/**` | 신규 — 위 구조 전체 |
| `dashboard/` | 변경 없음 — `forge-lab.json`만 있으면 자동으로 탭 인식(기존 컨벤션) |
| `docs/architecture.md` | 전체 아키텍처 다이어그램에 두 번째 실험 노드 추가 |
| `docs/issues.md` | kafka-forge 사용 중 발견되는 이슈 있으면 추가 |

## 영향성

| 영향 대상 | 영향 내용 |
|-----------|----------|
| waiting-room | 변경 없음 — 완전히 독립된 workspace |
| dashboard | 변경 없음 — panelUrl 방식은 이미 범용적으로 구현되어 있음 |
| node-forge / kafka-forge | 코드 변경 없음(참고만), 실사용 중 API 부족 발견 시 `proposals/`에 작성 |

## Breaking Changes

없음 — 신규 workspace 추가만 발생.

## 위험도

**MEDIUM** — 새 인프라(Kafka/Redpanda)를 docker-compose에 처음 추가하는 작업이라 로컬 환경
구성(브로커 기동, 토픽 자동 생성 여부, 두 NestJS 프로세스를 한 이미지로 command만 바꿔 띄우는 방식)에서
예상 못한 이슈가 나올 수 있음. 로직 자체(zincrby 등)는 node-forge에 이미 존재해 LOW에 가까움.

## 주의사항

- `forge/kafka-forge`, `forge/node-forge` 소스는 참고만 하고 실제 의존성은 `npm install
  @paikpaik/kafka-forge @paikpaik/node-forge`로 설치한다 (GitHub Packages, kafka-forge는 `v1.0.0`
  배포 확인됨).
- 토픽 이름은 반드시 `createTopicName()`을 거쳐서 만든다(kafka-forge 컨벤션, 직접 문자열 하드코딩 금지).
- Redpanda가 토픽을 자동 생성하는지(auto.create.topics.enable) 확인 필요 — 안 되면 컨테이너 기동 시
  admin API로 명시적 생성 스텝 추가.
- 하나의 Dockerfile로 두 이미지를 만들지 않고, docker-compose의 `command:`로 `dist/ingest/main.js`
  vs `dist/aggregator/main.js`를 선택 — Dockerfile 중복 방지.

## 작업 단계

### 1단계: workspace 스캐폴딩

1. `services/live-ranking/package.json`, `tsconfig.json` 생성 (waiting-room 컨벤션 따름:
   `tsc` 빌드, `ts-node-dev`로 개발 실행, vitest)
   - `npm install @paikpaik/kafka-forge @paikpaik/node-forge zod` (kafka-forge가 zod를 peer로
     요구하는지 확인 후 dependencies에 추가)
2. `src/shared/score-event.contract.ts` — `defineEvent` 정의

### 2단계: ingest 프로세스 (producer)

1. `IngestModule`, `IngestController`(`POST /leaderboards/:leaderboardId/events`)
2. `ScoreEventProducerService` — `OnModuleInit`에서 `StandardProducer.connect()`,
   `OnModuleDestroy`에서 `disconnect()`
3. node-forge `ResponseInterceptor`/`ForgeExceptionFilter` 적용해 waiting-room과 응답 형식 일관성 유지

### 3단계: aggregator 프로세스 (consumer + 조회 API)

1. `RankingService` — `zincrby`/`getTopN`/`getRankAndScore` 기반 CRUD
2. `RedisIdempotencyStore implements IdempotencyStore`
3. `ScoreEventConsumerService` — `OnModuleInit`에서 `subscribe` + `run`, `OnModuleDestroy`에서 disconnect
4. `RankingController` — 조회/리셋 API
5. node-forge `MetricsModule`/`HealthModule` 연결, kafka-forge의 `metricsRegistry`도 같은
   `/metrics` 응답에 합쳐서 노출(prom-client `Registry` 병합 방법 확인)

### 4단계: panel.html + Docker

1. `public/panel.html` — waiting-room 패턴 재사용: 랭킹 그리드(상위 N + 내 순위), "이벤트 발사"
   버튼(burst와 유사하게 여러 유저의 점수 이벤트를 ingest로 쏨), 발행-반영 사이 지연을 눈으로
   확인할 수 있는 이벤트 로그
2. `Dockerfile`(빌드 1개), `docker-compose.yml`(redis, redpanda, ingest, aggregator 4개 서비스)
3. `forge-lab.json`

### 5단계: 테스트 및 검증

1. vitest: `RankingService`(fake redis), `RedisIdempotencyStore`, contract 스키마 검증
2. `docker compose up --build -d` 후 curl로 이벤트 발행 → aggregator 조회 API로 반영 확인
3. 멱등성 검증: 같은 eventId로 두 번 발행 → 점수가 한 번만 반영되는지 확인
4. `ARCHITECTURE.md` 작성

## 검증 방법

- `npm test` 전부 통과
- Docker compose로 4개 컨테이너(redis, redpanda, ingest, aggregator) 기동 확인
- curl로 `POST /leaderboards/default/events` 발행 후 몇 초 내 `GET
  /leaderboards/default/top`에 반영되는 것 확인 (발행-반영 지연이 눈에 보여야 함 — waiting-room의
  admission 지연과 같은 학습 포인트)
- 같은 `eventId`로 중복 발행 시 점수가 중복 반영되지 않는 것 확인 (멱등성 저장소 동작 검증)
- 브라우저에서 panel.html 접속 후 "이벤트 발사" → 그리드 실시간 반영 확인

## 참조 규칙

- `.claude/rules/common/principles.md` — 저장소 구조/서비스 간 통신 방식은 임의로 정하지 않고
  사용자와 이미 확인함(단일 workspace + 두 프로세스/포트)
- `.claude/rules/project/convention.md` — forge 의존성은 GitHub Packages로 설치, dashboard는
  panelUrl로만 연결
- `forge/kafka-forge/.claude/rules/project/convention.md` — 토픽 네이밍은 `createTopicName()`
  경유 필수, Event Contract는 한 곳에서만 정의
