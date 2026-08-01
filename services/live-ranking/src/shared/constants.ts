export function leaderboardKey(leaderboardId: string): string {
  return `ranking:${leaderboardId}`;
}

export function idempotencyKey(topic: string, eventId: string): string {
  return `idempotency:${topic}:${eventId}`;
}

export const KAFKA_CLIENT_ID_INGEST = "live-ranking-ingest";
export const KAFKA_CLIENT_ID_AGGREGATOR = "live-ranking-aggregator";
export const AGGREGATOR_CONSUMER_GROUP_ID = "live-ranking-aggregator";

export const IDEMPOTENCY_TTL_SECONDS = Number(process.env.IDEMPOTENCY_TTL_SECONDS ?? 3600);

export const KAFKA_INSTANCE = Symbol("KAFKA_INSTANCE");

// createKafkaHealthChecker는 호출마다 새 Kafka Admin 연결을 열고 닫는다 — /health를 짧은
// 간격으로 반복 호출하는 환경에서 비용이 쌓인다. node-forge 1.0.4의 캐싱으로 완화한다
// (proposals/node-forge/20260719-health-checker-caching.md 반영).
export const HEALTH_CHECK_CACHE_MS = 5000;

export const DLQ_CONSUMER_GROUP_ID = "live-ranking-dlq-viewer";
export const DLQ_LOG_KEY = "dlq:score-event:log";
// ltrim으로 이 리스트는 최근 DLQ_LOG_LIMIT건만 물리적으로 유지한다 — 그래서 "총 몇 건
// 실패했는지"는 이 리스트 길이(llen)로 잴 수 없다. 별도 누적 카운터(DLQ_TOTAL_KEY)로 잰다.
export const DLQ_LOG_LIMIT = 20;
export const DLQ_TOTAL_KEY = "dlq:score-event:total";

// panel.html의 "DLQ 테스트" 버튼이 이 userId로 이벤트를 보내면 aggregator 핸들러가 항상
// 실패를 던진다 — 재시도(3회)까지 다 소진되면 DLQ로 이동하는 걸 실제로 눈으로 확인하기 위한
// 테스트/데모 전용 트리거. 정상적인 유저 흐름과는 무관하다.
export const DLQ_TEST_USER_ID = "__dlq-test__";

// panel.html의 "크래시 윈도우 재현" 버튼이 이 userId로 이벤트를 보내면, claim(선점)과 이펙트
// 적용(zincrby) 사이에 일부러 지연을 넣는다 — 그 지연 동안 컨테이너를 강제 종료(docker kill)
// 하면 "선점은 됐는데 이펙트는 반영 안 된" 크래시 윈도우를 사람이 직접 타이밍을 맞춰 재현할
// 수 있다(두 Redis 호출 사이의 자연 발생 간격은 수 ms라 타이밍을 맞추는 게 사실상 불가능해서
// 일부러 넓힘). 정상 유저 흐름과는 무관한 테스트/데모 전용 트리거.
export const CRASH_TEST_USER_ID = "__crash-test__";
export const CRASH_TEST_DELAY_MS = 8000;
