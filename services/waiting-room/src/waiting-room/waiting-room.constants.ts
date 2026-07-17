export function queueKey(roomId: string): string {
  return `waiting:${roomId}:queue`;
}

export function admittedKey(roomId: string, userId: string): string {
  return `waiting:${roomId}:admitted:${userId}`;
}

/**
 * admittedKey(실제 접근 토큰)와 별개로, "이 유저가 admission된 적이 있다"는 사실만 더 오래
 * 남기는 기록. admittedKey는 짧은 TTL이 지나면 사라져서 getStatus()가 "한 번도 등록 안 한
 * 사람"과 "입장 기회를 놓친 사람"을 구분 못 하는데, 이 키로 그 둘을 나눈다. 권한 판단에는
 * 절대 쓰지 않는다(그건 항상 admittedKey 기준).
 */
export function admissionLogKey(roomId: string, userId: string): string {
  return `waiting:${roomId}:admission-log:${userId}`;
}

export const ADMISSION_INTERVAL_MS = Number(process.env.ADMISSION_INTERVAL_MS ?? 5000);
export const ADMISSION_BATCH_SIZE = Number(process.env.ADMISSION_BATCH_SIZE ?? 10);
export const ADMITTED_TOKEN_TTL_SECONDS = Number(process.env.ADMITTED_TOKEN_TTL_SECONDS ?? 300);
export const ADMISSION_LOG_TTL_SECONDS = Number(process.env.ADMISSION_LOG_TTL_SECONDS ?? 3600);
export const ADMISSION_TOKEN_SECRET = process.env.ADMISSION_TOKEN_SECRET ?? "dev-secret";

/**
 * 멀티룸 스케줄링은 스코프 아웃 — admission 스케줄러는 이 room만 순회한다.
 * API 경로(:roomId)는 열어두되, 두 번째 room이 실제로 필요해질 때 순회 로직을 확장한다.
 */
export const ADMISSION_ROOM_ID = process.env.ROOM_ID ?? "default";
