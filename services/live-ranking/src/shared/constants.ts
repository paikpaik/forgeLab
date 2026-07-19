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

export const DLQ_CONSUMER_GROUP_ID = "live-ranking-dlq-viewer";
export const DLQ_LOG_KEY = "dlq:score-event:log";
export const DLQ_LOG_LIMIT = 20;

// panel.html의 "DLQ 테스트" 버튼이 이 userId로 이벤트를 보내면 aggregator 핸들러가 항상
// 실패를 던진다 — 재시도(3회)까지 다 소진되면 DLQ로 이동하는 걸 실제로 눈으로 확인하기 위한
// 테스트/데모 전용 트리거. 정상적인 유저 흐름과는 무관하다.
export const DLQ_TEST_USER_ID = "__dlq-test__";
