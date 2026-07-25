import { describe, it, expect } from "vitest";
import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RolesGuard } from "./roles.guard";
import { Role } from "./auth-token.service";

function fakeContext(
  role: Role | undefined,
  requiredRoles: Role[] | undefined,
): { context: ExecutionContext; reflector: Reflector } {
  const reflector = { get: () => requiredRoles } as unknown as Reflector;

  const context = {
    getHandler: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { userId: "u1", role } : undefined }),
    }),
  } as unknown as ExecutionContext;

  return { context, reflector };
}

describe("RolesGuard", () => {
  it("@Roles가 없으면 누구나 통과한다", () => {
    const { context, reflector } = fakeContext("customer", undefined);
    expect(new RolesGuard(reflector).canActivate(context)).toBe(true);
  });

  it("요구 role과 사용자 role이 일치하면 통과한다", () => {
    const { context, reflector } = fakeContext("admin", ["admin"]);
    expect(new RolesGuard(reflector).canActivate(context)).toBe(true);
  });

  it("요구 role과 사용자 role이 다르면 ForbiddenException을 던진다", () => {
    const { context, reflector } = fakeContext("customer", ["admin"]);
    expect(() => new RolesGuard(reflector).canActivate(context)).toThrow();
  });

  it("user가 없으면(AuthGuard를 안 거쳤으면) 거부한다", () => {
    const { context, reflector } = fakeContext(undefined, ["customer"]);
    expect(() => new RolesGuard(reflector).canActivate(context)).toThrow();
  });
});
