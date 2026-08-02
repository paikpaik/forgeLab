import { IsInt, IsString, Max, Min } from "class-validator";

export class CreateAuctionDto {
  @IsString()
  title!: string;

  @IsString()
  description!: string;

  @IsInt()
  @Min(1)
  startingPrice!: number;

  @IsInt()
  @Min(1)
  minIncrement!: number;

  @IsInt()
  @Min(5)
  @Max(3600)
  durationSeconds!: number;
}
