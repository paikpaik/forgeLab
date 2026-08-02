import { IsInt, IsString, Min } from "class-validator";

export class PlaceBidDto {
  @IsString()
  bidderId!: string;

  @IsInt()
  @Min(1)
  amount!: number;
}
