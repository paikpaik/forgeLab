import { IsInt, IsOptional, IsString, Min } from "class-validator";

export class CreatePaymentDto {
  @IsString()
  merchantId!: string;

  @IsInt()
  @Min(1)
  amount!: number;

  // 없으면 서버가 생성한다 — 가맹점이 재요청(네트워크 재시도 등)해도 같은 키면 새 결제가
  // 생기지 않고 기존 결제의 현재 상태를 그대로 반환한다(멱등 생성).
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
