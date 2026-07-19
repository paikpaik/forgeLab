import { describe, it, expect } from "vitest";
import { TokenService } from "./token.service";

describe("TokenService", () => {
  const tokenService = new TokenService();

  it("발급한 토큰을 검증하면 원래 roomId/userId가 그대로 나온다", () => {
    const token = tokenService.issue("default", "user-1");
    const decoded = tokenService.verify(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.roomId).toBe("default");
    expect(decoded?.userId).toBe("user-1");
  });

  it("변조된 토큰은 검증에 실패한다", () => {
    const token = tokenService.issue("default", "user-1");
    const tampered = token.slice(0, -2) + "xx";
    expect(tokenService.verify(tampered)).toBeNull();
  });

  it("형식이 아예 다른 문자열은 검증에 실패한다", () => {
    expect(tokenService.verify("not-a-real-token")).toBeNull();
  });

  it("서로 다른 유저의 토큰은 각자의 userId로만 검증된다", () => {
    const tokenA = tokenService.issue("default", "user-a");
    const tokenB = tokenService.issue("default", "user-b");
    expect(tokenService.verify(tokenA)?.userId).toBe("user-a");
    expect(tokenService.verify(tokenB)?.userId).toBe("user-b");
  });
});
