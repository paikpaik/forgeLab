export const KAFKA_CLIENT_ID_INGEST = "webhook-relay-ingest";
export const KAFKA_CLIENT_ID_DELIVERY_WORKER = "webhook-relay-delivery-worker";
export const DELIVERY_WORKER_CONSUMER_GROUP_ID = "webhook-relay-delivery-worker";

export const KAFKA_INSTANCE = Symbol("KAFKA_INSTANCE");

export const OUTBOX_PUBLISH_INTERVAL_MS = Number(process.env.OUTBOX_PUBLISH_INTERVAL_MS ?? 2000);
export const OUTBOX_PUBLISH_BATCH_SIZE = Number(process.env.OUTBOX_PUBLISH_BATCH_SIZE ?? 50);

export const RETRY_POLL_INTERVAL_MS = Number(process.env.RETRY_POLL_INTERVAL_MS ?? 5000);
export const MAX_DELIVERY_ATTEMPTS = Number(process.env.MAX_DELIVERY_ATTEMPTS ?? 5);
// Kafka로 최초 시도를 트리거했는데도 그 시도가 아직 안 왔을 때(발행 지연/유실 대비 안전망)
// 재시도 폴러가 대신 집어가기까지 기다리는 유예 시간 — 너무 짧으면 정상적인 Kafka 경로와
// 폴러가 같은 delivery를 동시에 건드릴 수 있다.
export const FIRST_ATTEMPT_FALLBACK_GRACE_MS = Number(process.env.FIRST_ATTEMPT_FALLBACK_GRACE_MS ?? 10_000);

// 지수 백오프: 30초 → 2분 → 10분 → 1시간 → 6시간 (Stripe 등 실제 웹훅 플랫폼의 재시도
// 스케줄과 같은 자릿수 감각 — 마지막 시도까지 총 몇 시간대에 걸쳐 재시도한다는 걸 보여주기 위함)
export const RETRY_BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];

export function nextBackoffMs(attempts: number): number {
  const index = Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1);
  return RETRY_BACKOFF_MS[Math.max(index, 0)];
}

export const CIRCUIT_FAILURE_THRESHOLD = Number(process.env.CIRCUIT_FAILURE_THRESHOLD ?? 3);
export const CIRCUIT_RESET_TIMEOUT_MS = Number(process.env.CIRCUIT_RESET_TIMEOUT_MS ?? 20_000);

export function circuitKey(endpointId: string): string {
  return `circuit:${endpointId}`;
}

export const HEALTH_CHECK_CACHE_MS = 5000;

// panel.html의 시나리오 선택 드롭다운과 test-receiver의 라우트가 공유하는 값.
export const TEST_RECEIVER_SCENARIOS = ["ok", "fail", "slow", "timeout"] as const;
export type TestReceiverScenario = (typeof TEST_RECEIVER_SCENARIOS)[number];
