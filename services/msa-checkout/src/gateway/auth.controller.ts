import { Body, Controller, Post, UseInterceptors } from "@nestjs/common";
import { ResponseInterceptor } from "@paikpaik/node-forge/response/nestjs";
import { signToken } from "@paikpaik/node-forge/auth";
import { AUTH_TOKEN_SECRET, AUTH_TOKEN_TTL } from "../shared/constants";
import { IssueTokenDto } from "./dto/issue-token.dto";

@Controller("auth")
@UseInterceptors(ResponseInterceptor)
export class AuthController {
  @Post("token")
  issue(@Body() dto: IssueTokenDto): { token: string } {
    const token = signToken(
      { sub: dto.userId, role: dto.role },
      { secret: AUTH_TOKEN_SECRET, expiresIn: AUTH_TOKEN_TTL },
    );
    return { token };
  }
}
