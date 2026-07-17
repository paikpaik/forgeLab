import { IsInt, IsOptional, IsString, IsUUID, MinLength } from "class-validator";

export class SubmitScoreEventDto {
  @IsString()
  @MinLength(1)
  userId!: string;

  @IsInt()
  delta!: number;

  // 클라이언트가 재시도 시 같은 이벤트로 취급되길 원하면 직접 지정한다. 생략하면 서버가 매번
  // 새로 발급하므로 HTTP 재시도 자체의 중복은 못 막는다 — 이 실험이 다루는 멱등성은 "Kafka
  // 재배달로 인한 consumer의 중복 반영"이고, HTTP 레벨 멱등성은 스코프 밖이다.
  @IsOptional()
  @IsUUID()
  eventId?: string;
}
