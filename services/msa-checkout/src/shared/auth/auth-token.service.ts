import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

export type Role = "customer" | "admin";

export interface AuthUser {
  userId: string;
  role: Role;
}

interface AccessTokenClaims {
  sub: string;
  role: string;
}

// @nestjs/jwt(jsonwebtoken 래퍼)로 실제 발급/검증 — 처음엔 HMAC을 직접 구현했지만(waiting-room의
// TokenService와 같은 패턴), "회원 인증의 bearer 토큰은 JWT가 사실상 표준이고 node-forge를
// 실서비스에 쓸 때도 결국 필요해진다"는 판단에 따라 JWT로 교체하고 검증한 뒤 그 설계를 근거로
// node-forge에 제안서를 썼다(proposals/node-forge/20260725/20260725-jwt-auth-module.md).
@Injectable()
export class AuthTokenService {
  constructor(private readonly jwtService: JwtService) {}

  issue(userId: string, role: Role): string {
    return this.jwtService.sign({ sub: userId, role });
  }

  verify(token: string): AuthUser | null {
    let claims: AccessTokenClaims;
    try {
      claims = this.jwtService.verify<AccessTokenClaims>(token);
    } catch {
      // 서명 불일치, 만료(TokenExpiredError), 형식 손상 등 — jsonwebtoken이 전부 예외로 던짐
      return null;
    }

    if (claims.role !== "customer" && claims.role !== "admin") return null;
    return { userId: claims.sub, role: claims.role };
  }
}
