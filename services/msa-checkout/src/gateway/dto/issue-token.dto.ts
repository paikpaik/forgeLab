import { IsIn, IsString, MinLength } from "class-validator";
import { Role } from "../../shared/auth/auth-token.service";

// 이 실험은 로그인 시스템 자체가 아니라 게이트웨이 인증/인가 패턴을 검증하는 게 목적이라,
// 실제 유저 스토어 없이 "userId+role을 주면 그 값으로 서명된 토큰을 내준다" — waiting-room의
// 테스트 전용 엔드포인트, order-outbox의 OUTBOX_POISON_ITEM과 같은 성격의 랩 전용 단순화.
export class IssueTokenDto {
  @IsString()
  @MinLength(1)
  userId!: string;

  @IsIn(["customer", "admin"])
  role!: Role;
}
