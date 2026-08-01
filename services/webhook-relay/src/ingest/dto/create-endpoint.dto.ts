import { ArrayMinSize, IsArray, IsString, IsUrl, MinLength } from "class-validator";

export class CreateEndpointDto {
  // localhost 테스트 수신 서버를 가리켜야 해서 IsUrl의 기본 옵션(require_tld 등)은 완화한다.
  @IsUrl({ require_tld: false })
  url!: string;

  @IsString()
  @MinLength(1)
  secret!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  eventTypes!: string[];
}
