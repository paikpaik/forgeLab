import { IsInt, IsString, Min } from "class-validator";

export class ChargeRequestDto {
  @IsString()
  clientReference!: string;

  @IsInt()
  @Min(1)
  amount!: number;
}
