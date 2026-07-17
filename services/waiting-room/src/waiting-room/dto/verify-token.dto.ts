import { IsString, MinLength } from "class-validator";

export class VerifyTokenDto {
  @IsString()
  @MinLength(1)
  token!: string;
}
