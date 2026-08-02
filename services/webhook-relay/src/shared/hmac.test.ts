import { describe, it, expect } from "vitest";
import { signPayload, verifySignature } from "./hmac";

describe("signPayload/verifySignature", () => {
  it("올바른 secret으로 서명하면 검증을 통과한다", () => {
    const body = JSON.stringify({ a: 1 });
    const signature = signPayload(body, "secret-1");
    expect(verifySignature(body, signature, "secret-1")).toEqual({ valid: true });
  });

  it("다른 secret으로 검증하면 실패한다", () => {
    const body = JSON.stringify({ a: 1 });
    const signature = signPayload(body, "secret-1");
    const result = verifySignature(body, signature, "secret-2");
    expect(result.valid).toBe(false);
  });

  it("body가 조금이라도 바뀌면 검증에 실패한다", () => {
    const body = JSON.stringify({ a: 1 });
    const signature = signPayload(body, "secret-1");
    const tampered = JSON.stringify({ a: 2 });
    expect(verifySignature(tampered, signature, "secret-1").valid).toBe(false);
  });

  it("서명 헤더가 없으면 실패한다", () => {
    expect(verifySignature("body", undefined, "secret-1").valid).toBe(false);
  });

  it("타임스탬프가 허용 범위를 벗어나면(리플레이 의심) 실패한다", () => {
    const body = "body";
    const oldTimestamp = Date.now() - 10 * 60_000; // 10분 전
    const signature = signPayload(body, "secret-1", oldTimestamp);
    const result = verifySignature(body, signature, "secret-1", 5 * 60_000);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("리플레이");
  });

  it("형식이 잘못된 헤더는 실패한다", () => {
    expect(verifySignature("body", "not-a-valid-header", "secret-1").valid).toBe(false);
  });
});
