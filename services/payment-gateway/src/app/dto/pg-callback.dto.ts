import { IsIn, IsOptional, IsString } from "class-validator";

// fake-pg가 비동기(202 접수) 거래의 최종 결과를 나중에 알려줄 때 보내는 웹훅 페이로드.
export class PgCallbackDto {
  @IsString()
  clientReference!: string;

  @IsOptional()
  @IsString()
  pgTransactionId?: string;

  @IsIn(["APPROVED", "DECLINED"])
  status!: "APPROVED" | "DECLINED";

  @IsOptional()
  @IsString()
  reason?: string;
}
