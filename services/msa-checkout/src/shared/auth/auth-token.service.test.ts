import { describe, it, expect, vi, afterEach } from "vitest";
import { JwtService } from "@nestjs/jwt";
import { AuthTokenService } from "./auth-token.service";

function createService(overrides: { secret?: string; expiresIn?: string } = {}) {
  const jwtService = new JwtService({
    secret: overrides.secret ?? "test-secret",
    signOptions: { expiresIn: overrides.expiresIn ?? "15m" },
  });
  return new AuthTokenService(jwtService);
}

describe("AuthTokenService (JWT)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("발급한 토큰을 검증하면 원래 userId/role이 나온다", () => {
    const service = createService();
    const token = service.issue("user-1", "customer");

    expect(service.verify(token)).toEqual({ userId: "user-1", role: "customer" });
  });

  it("JWT는 header.payload.signature 3-segment 구조를 갖는다", () => {
    const service = createService();
    const token = service.issue("user-1", "customer");
    expect(token.split(".")).toHaveLength(3);
  });

  it("payload를 변조하면(권한 상승 시도) 서명이 안 맞아 거부한다", () => {
    const service = createService();
    const token = service.issue("user-1", "customer");
    const [header, payload, signature] = token.split(".");

    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const tamperedPayload = Buffer.from(JSON.stringify({ ...decoded, role: "admin" })).toString("base64url");
    const tamperedToken = `${header}.${tamperedPayload}.${signature}`;

    expect(service.verify(tamperedToken)).toBeNull();
  });

  it("다른 secret으로 서명된 토큰은 거부한다", () => {
    const issuer = createService({ secret: "secret-a" });
    const verifier = createService({ secret: "secret-b" });
    const token = issuer.issue("user-1", "customer");

    expect(verifier.verify(token)).toBeNull();
  });

  it("role이 customer/admin이 아니면 거부한다", () => {
    // JwtService.sign은 임의 payload를 그대로 서명하므로, 유효하지 않은 role도 서명 자체는
    // 성공한다 — AuthTokenService.verify가 서명 이후 애플리케이션 레벨에서 걸러내야 한다.
    const jwtService = new JwtService({ secret: "test-secret" });
    const service = new AuthTokenService(jwtService);
    const forgedToken = jwtService.sign({ sub: "user-1", role: "superadmin" });

    expect(service.verify(forgedToken)).toBeNull();
  });

  it("형식이 깨진 토큰은 예외 없이 null을 반환한다", () => {
    const service = createService();
    expect(service.verify("not-a-valid-token")).toBeNull();
  });

  it("TTL을 넘긴 토큰은 만료로 거부한다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const service = createService({ expiresIn: "15m" });
    const token = service.issue("user-1", "customer");

    vi.setSystemTime(new Date("2026-01-01T00:20:00Z")); // TTL(15분) 초과
    expect(service.verify(token)).toBeNull();
  });
});
