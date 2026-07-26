import { IsInt, IsString, Max, Min, MinLength } from "class-validator";

export class StartCheckoutDto {
  @IsString()
  @MinLength(1)
  productId!: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  quantity!: number;
}
