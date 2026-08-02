import { IsObject, IsString, MinLength } from "class-validator";

export class PublishEventDto {
  @IsString()
  @MinLength(1)
  type!: string;

  @IsObject()
  payload!: Record<string, unknown>;
}
