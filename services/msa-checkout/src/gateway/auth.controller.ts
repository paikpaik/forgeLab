import { Body, Controller, Post, UseInterceptors } from "@nestjs/common";
import { ResponseInterceptor } from "@paikpaik/node-forge/response/nestjs";
import { AuthTokenService } from "../shared/auth/auth-token.service";
import { IssueTokenDto } from "./dto/issue-token.dto";

@Controller("auth")
@UseInterceptors(ResponseInterceptor)
export class AuthController {
  constructor(private readonly tokenService: AuthTokenService) {}

  @Post("token")
  issue(@Body() dto: IssueTokenDto): { token: string } {
    return { token: this.tokenService.issue(dto.userId, dto.role) };
  }
}
