export function queueKey(roomId: string): string {
  return `waiting:${roomId}:queue`;
}

export function admittedKey(roomId: string, userId: string): string {
  return `waiting:${roomId}:admitted:${userId}`;
}

export const ADMISSION_INTERVAL_MS = Number(process.env.ADMISSION_INTERVAL_MS ?? 5000);
export const ADMISSION_BATCH_SIZE = Number(process.env.ADMISSION_BATCH_SIZE ?? 10);
export const ADMITTED_TOKEN_TTL_SECONDS = Number(process.env.ADMITTED_TOKEN_TTL_SECONDS ?? 300);
export const ADMISSION_TOKEN_SECRET = process.env.ADMISSION_TOKEN_SECRET ?? "dev-secret";

/**
 * 멀티룸 스케줄링은 스코프 아웃 — admission 스케줄러는 이 room만 순회한다.
 * API 경로(:roomId)는 열어두되, 두 번째 room이 실제로 필요해질 때 순회 로직을 확장한다.
 */
export const ADMISSION_ROOM_ID = process.env.ROOM_ID ?? "default";
