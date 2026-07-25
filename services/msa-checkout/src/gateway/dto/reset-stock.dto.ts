import { IsInt, Min } from "class-validator";

export class ResetStockDto {
  @IsInt()
  @Min(0)
  total!: number;
}
