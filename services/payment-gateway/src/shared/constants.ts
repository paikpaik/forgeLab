export type PaymentStatus = "PENDING" | "CONFIRMED" | "FAILED" | "IN_DOUBT" | "DEAD";

export type PaymentAttemptOutcome =
  | "SUCCESS"
  | "DECLINED"
  | "PG_ERROR"
  | "TIMEOUT"
  | "CIRCUIT_OPEN"
  | "WEBHOOK_CONFIRMED"
  | "WEBHOOK_FAILED"
  | "RECONCILED";

export const PG_CIRCUIT_KEY = "fake-pg";

export const RECONCILE_INTERVAL_MS = Number(process.env.RECONCILE_INTERVAL_MS ?? 3000);
export const MAX_RECONCILE_ATTEMPTS = Number(process.env.MAX_RECONCILE_ATTEMPTS ?? 5);

export const CIRCUIT_FAILURE_THRESHOLD = Number(process.env.CIRCUIT_FAILURE_THRESHOLD ?? 3);
export const CIRCUIT_RESET_TIMEOUT_MS = Number(process.env.CIRCUIT_RESET_TIMEOUT_MS ?? 15_000);

export const FAKE_PG_TIMEOUT_MS = Number(process.env.FAKE_PG_TIMEOUT_MS ?? 3000);

export const API_VERSION_OPTIONS = {
  defaultVersion: "v2",
  supportedVersions: ["v1", "v2"] as string[],
};
