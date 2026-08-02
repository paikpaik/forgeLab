import { IsInt, IsNumber, IsOptional, Max, Min } from "class-validator";

// 각 확률은 독립적으로 더해져서 하나의 룰렛을 이룬다(합이 1을 넘으면 안 됨) — 나머지 구간은
// 정상 동기 승인/거절(고정 15% 거절)로 처리된다. 자세한 건 fake-pg.service.ts의 charge() 참고.
export class FakePgConfigDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  failureRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  timeoutRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  asyncRate?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  latencyMs?: number;
}
