import { Body, Controller, Get, Param, Post, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { ResponseInterceptor } from "@paikpaik/node-forge/response/nestjs";
import { AuthGuard, AuthedRequest } from "../shared/auth/auth.guard";
import { RolesGuard } from "../shared/auth/roles.guard";
import { Roles } from "../shared/auth/roles.decorator";
import { OrchestratorGrpcClient } from "./clients/orchestrator-grpc-client";
import { StartCheckoutDto } from "./dto/start-checkout.dto";

@Controller()
@UseInterceptors(ResponseInterceptor)
@UseGuards(AuthGuard, RolesGuard)
export class CheckoutController {
  constructor(private readonly orchestrator: OrchestratorGrpcClient) {}

  @Post("checkout")
  @Roles("customer")
  async startCheckout(@Body() dto: StartCheckoutDto, @Req() req: AuthedRequest) {
    const { sagaId } = await this.orchestrator.startCheckout(req.user!.userId, dto.productId, dto.quantity);
    return { sagaId };
  }

  @Get("checkout/:sagaId")
  @Roles("customer", "admin")
  async getStatus(@Param("sagaId") sagaId: string) {
    return this.orchestrator.getSagaStatus(sagaId);
  }
}
