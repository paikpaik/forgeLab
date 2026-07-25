import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { AuthTokenService, AuthUser } from "./auth-token.service";

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly tokenService: AuthTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    if (!token) throw new UnauthorizedException("Authorization 헤더가 없습니다");

    const user = this.tokenService.verify(token);
    if (!user) throw new UnauthorizedException("유효하지 않거나 만료된 토큰입니다");

    request.user = user;
    return true;
  }
}
