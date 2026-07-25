import { Body, Controller, Get, Param, Post, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { ResponseInterceptor } from "@paikpaik/node-forge/response/nestjs";
import { JwtAuthGuard, RolesGuard, Roles } from "@paikpaik/node-forge/auth/nestjs";
import type { AuthedRequest } from "@paikpaik/node-forge/auth/nestjs";
import { Role } from "../shared/constants";
import { OrchestratorGrpcClient } from "./clients/orchestrator-grpc-client";
import { StartCheckoutDto } from "./dto/start-checkout.dto";

type AccessTokenClaims = { sub: string; role: Role };

@Controller()
@UseInterceptors(ResponseInterceptor)
@UseGuards(JwtAuthGuard, RolesGuard)
export class CheckoutController {
  constructor(private readonly orchestrator: OrchestratorGrpcClient) {}

  @Post("checkout")
  @Roles("customer")
  async startCheckout(@Body() dto: StartCheckoutDto, @Req() req: AuthedRequest<AccessTokenClaims>) {
    const { sagaId } = await this.orchestrator.startCheckout(req.user!.sub, dto.productId, dto.quantity);
    return { sagaId };
  }

  @Get("checkout/:sagaId")
  @Roles("customer", "admin")
  async getStatus(@Param("sagaId") sagaId: string) {
    return this.orchestrator.getSagaStatus(sagaId);
  }
}
