import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ADMISSION_TOKEN_SECRET } from "./waiting-room.constants";

/**
 * 입장 토큰은 외부 JWT 라이브러리 없이 HMAC 서명만으로 발급한다.
 * 페이로드는 `roomId:userId:issuedAt`이고, 검증은 서명 재계산 후 timingSafeEqual로 비교한다.
 */
@Injectable()
export class TokenService {
  issue(roomId: string, userId: string): string {
    const payload = `${roomId}:${userId}:${Date.now()}`;
    const signature = this.sign(payload);
    return Buffer.from(`${payload}:${signature}`).toString("base64url");
  }

  verify(token: string): { roomId: string; userId: string; issuedAt: number } | null {
    let decoded: string;
    try {
      decoded = Buffer.from(token, "base64url").toString("utf8");
    } catch {
      return null;
    }

    const parts = decoded.split(":");
    if (parts.length !== 4) return null;
    const [roomId, userId, issuedAtRaw, signature] = parts;
    const payload = `${roomId}:${userId}:${issuedAtRaw}`;
    const expected = this.sign(payload);

    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(signature);
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
      return null;
    }

    return { roomId, userId, issuedAt: Number(issuedAtRaw) };
  }

  private sign(payload: string): string {
    return createHmac("sha256", ADMISSION_TOKEN_SECRET).update(payload).digest("hex");
  }
}
