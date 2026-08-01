import { IsString, MinLength } from "class-validator";

export class CreateTenantDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
