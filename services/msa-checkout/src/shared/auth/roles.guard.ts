import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "./roles.decorator";
import { Role } from "./auth-token.service";
import { AuthedRequest } from "./auth.guard";

// AuthGuard가 먼저 request.user를 채워둔 뒤에만 의미가 있다 — 컨트롤러에는 항상
// @UseGuards(AuthGuard, RolesGuard) 순서로 붙인다.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<Role[] | undefined>(ROLES_KEY, context.getHandler());
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const role = request.user?.role;
    if (!role || !requiredRoles.includes(role)) {
      throw new ForbiddenException(`이 작업은 [${requiredRoles.join(", ")}] 권한이 필요합니다`);
    }
    return true;
  }
}
