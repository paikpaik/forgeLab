export type WaitingStatusDto =
  | { status: "waiting"; position: number; queueLength: number }
  | { status: "admitted"; token: string }
  | { status: "expired" }
  | { status: "not_found" };

export interface RegisterResultDto {
  position: number;
  queueLength: number;
}

export interface QueueOverviewDto {
  queueLength: number;
  waiting: { userId: string; position: number }[];
}

export type VerifyTokenResultDto = { valid: true; userId: string } | { valid: false };
