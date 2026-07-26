import { ForbiddenException, Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

// 데모/테스트 전용 간단한 deny-list — 실서비스라면 WAF/L4 로드밸런서가 담당할 일이지만,
// 이 실험에서는 "정책" 계층이 실제로 존재한다는 걸 보여주는 최소 구현으로 충분하다.
const BLOCKED_IPS = new Set(
  (process.env.BLOCKED_IPS ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean),
);

@Injectable()
export class IpBlockMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    if (BLOCKED_IPS.has(req.ip ?? "")) {
      throw new ForbiddenException("차단된 IP입니다");
    }
    next();
  }
}
