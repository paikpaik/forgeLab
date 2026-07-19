import { IsInt, IsString, Max, Min, MinLength } from "class-validator";

const MAX_AMOUNT = 1_000_000;

export class CreateOrderDto {
  @IsString()
  @MinLength(1)
  item!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT)
  amount!: number;
}
