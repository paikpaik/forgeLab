import { ArrayMinSize, ArrayMaxSize, IsArray, IsString } from "class-validator";

export class RemoveWaitingUsersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  userIds!: string[];
}
