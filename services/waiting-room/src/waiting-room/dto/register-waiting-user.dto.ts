import { IsString, MinLength } from "class-validator";

export class RegisterWaitingUserDto {
  @IsString()
  @MinLength(1)
  userId!: string;
}
