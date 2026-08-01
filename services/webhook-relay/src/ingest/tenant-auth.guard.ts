import { CanActivate, ExecutionContext, Injectable, createParamDecorator } from "@nestjs/common";
import { ForgeBizError } from "@paikpaik/node-forge/core";
import { TenantsService } from "./tenants.service";
import type { TenantEntity } from "../entities/tenant.entity";

// msa-checkout의 JWT 인증과 달리 여기는 테넌트(고객사) 단위 API 키 인증이다 — 웹훅
// 플랫폼은 보통 사람 로그인이 아니라 서버-to-서버 API 키로 인증하는 게 실무 관행에 더 가깝다.
@Injectable()
export class TenantAuthGuard implements CanActivate {
  constructor(private readonly tenantsService: TenantsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers["x-api-key"];
    if (!apiKey) {
      throw new ForgeBizError("E9401", "X-Api-Key 헤더가 필요합니다");
    }

    const tenant = await this.tenantsService.findByApiKey(apiKey);
    if (!tenant) {
      throw new ForgeBizError("E9401", "유효하지 않은 API 키입니다");
    }

    request.tenant = tenant;
    return true;
  }
}

export const CurrentTenant = createParamDecorator((_data: unknown, ctx: ExecutionContext): TenantEntity => {
  return ctx.switchToHttp().getRequest().tenant;
});
