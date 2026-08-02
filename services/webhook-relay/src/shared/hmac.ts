import { createHmac, timingSafeEqual } from "node:crypto";

// Stripe의 웹훅 서명 방식과 같은 구조 — 타임스탬프를 서명에 포함시켜서, 탈취된 페이로드를
// 나중에 재전송하는 리플레이 공격도 수신 측에서 타임스탬프 기준으로 걸러낼 수 있게 한다.
// 헤더 형식: "t=<epoch ms>,v1=<hex hmac-sha256>"
export function signPayload(rawBody: string, secret: string, timestamp: number = Date.now()): string {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
}

// test-receiver가 실제로 서명을 검증할 때 쓴다 — timingSafeEqual로 타이밍 공격을 막는다
// (문자열을 `===`로 바로 비교하면 첫 글자부터 다른 경우와 마지막 글자만 다른 경우의 비교
// 시간 차이로 정답에 조금씩 가까워지는 걸 추측당할 수 있다).
export function verifySignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  toleranceMs = 5 * 60_000,
): VerifyResult {
  if (!header) return { valid: false, reason: "서명 헤더 없음" };

  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=") as [string, string]));
  const timestamp = Number(parts.t);
  const received = parts.v1;
  if (!timestamp || !received) return { valid: false, reason: "서명 헤더 형식 오류" };

  if (Math.abs(Date.now() - timestamp) > toleranceMs) {
    return { valid: false, reason: "타임스탬프 허용 범위 초과(리플레이 의심)" };
  }

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const receivedBuf = Buffer.from(received, "hex");
  if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) {
    return { valid: false, reason: "서명 불일치" };
  }
  return { valid: true };
}
