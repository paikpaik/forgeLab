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
