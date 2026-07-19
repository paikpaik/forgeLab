import { IsInt, IsOptional, IsString, IsUUID, Max, Min, MinLength } from "class-validator";

// 상/하한은 정확한 비즈니스 한도가 아니라, 임의로 거대한 값이 실수로(혹은 악의적으로) 들어와
// 랭킹을 왜곡하는 걸 막는 안전판이다. 패널의 버스트 시뮬레이션(최대 델타 1000)보다는 넉넉하게 잡음.
const MAX_DELTA = 1_000_000;

export class SubmitScoreEventDto {
  @IsString()
  @MinLength(1)
  userId!: string;

  @IsInt()
  @Min(-MAX_DELTA)
  @Max(MAX_DELTA)
  delta!: number;

  // 클라이언트가 재시도 시 같은 이벤트로 취급되길 원하면 직접 지정한다. 생략하면 서버가 매번
  // 새로 발급하므로 HTTP 재시도 자체의 중복은 못 막는다 — 이 실험이 다루는 멱등성은 "Kafka
  // 재배달로 인한 consumer의 중복 반영"이고, HTTP 레벨 멱등성은 스코프 밖이다.
  @IsOptional()
  @IsUUID()
  eventId?: string;
}
