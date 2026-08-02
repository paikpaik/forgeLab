import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { ResponseInterceptor } from "@paikpaik/node-forge/response/nestjs";
import { JwtAuthGuard, RolesGuard, Roles } from "@paikpaik/node-forge/auth/nestjs";
import type { AuthedRequest } from "@paikpaik/node-forge/auth/nestjs";
import { AdminEventBus } from "@paikpaik/node-forge/events";
import { ADMIN_EVENT_BUS } from "@paikpaik/node-forge/events/nestjs";
import { Role } from "../shared/constants";
import type { AdminLogEvent } from "../shared/admin-log-event";
import { OrchestratorGrpcClient } from "./clients/orchestrator-grpc-client";
import { StartCheckoutDto } from "./dto/start-checkout.dto";

type AccessTokenClaims = { sub: string; role: Role };

@Controller()
@UseInterceptors(ResponseInterceptor)
@UseGuards(JwtAuthGuard, RolesGuard)
export class CheckoutController {
  constructor(
    private readonly orchestrator: OrchestratorGrpcClient,
    @Inject(ADMIN_EVENT_BUS) private readonly adminEvents: AdminEventBus<AdminLogEvent>,
  ) {}

  @Post("checkout")
  @Roles("customer")
  async startCheckout(@Body() dto: StartCheckoutDto, @Req() req: AuthedRequest<AccessTokenClaims>) {
    const { sagaId } = await this.orchestrator.startCheckout(req.user!.sub, dto.productId, dto.quantity);
    this.adminEvents.emit({
      message: `체크아웃 시작 — ${dto.productId} x${dto.quantity} (saga ${sagaId.slice(0, 8)}…)`,
      at: new Date().toISOString(),
    });
    return { sagaId };
  }

  @Get("checkout/:sagaId")
  @Roles("customer", "admin")
  async getStatus(@Param("sagaId") sagaId: string) {
    return this.orchestrator.getSagaStatus(sagaId);
  }
}
