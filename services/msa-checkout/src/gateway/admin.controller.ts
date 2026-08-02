import { Body, Controller, Get, Inject, Param, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { ResponseInterceptor } from "@paikpaik/node-forge/response/nestjs";
import { JwtAuthGuard, RolesGuard, Roles } from "@paikpaik/node-forge/auth/nestjs";
import { AdminEventBus } from "@paikpaik/node-forge/events";
import { ADMIN_EVENT_BUS } from "@paikpaik/node-forge/events/nestjs";
import type { AdminLogEvent } from "../shared/admin-log-event";
import { InventoryAdminGrpcClient } from "./clients/inventory-admin-grpc-client";
import { ResetStockDto } from "./dto/reset-stock.dto";

// 인가(authorization) 시연 대상 — 재고 강제 리셋은 admin만, 조회는 customer/admin 둘 다.
// saga 흐름과 무관한 관리 작업이라 orchestrator를 거치지 않고 inventory-service를 직접 호출.
@Controller("admin/inventory")
@UseInterceptors(ResponseInterceptor)
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  constructor(
    private readonly inventoryAdmin: InventoryAdminGrpcClient,
    @Inject(ADMIN_EVENT_BUS) private readonly adminEvents: AdminEventBus<AdminLogEvent>,
  ) {}

  @Post(":productId/reset")
  @Roles("admin")
  async reset(@Param("productId") productId: string, @Body() dto: ResetStockDto) {
    const result = await this.inventoryAdmin.resetStock(productId, dto.total);
    this.adminEvents.emit({
      message: `재고 리셋 — ${productId}를 ${dto.total}로`,
      at: new Date().toISOString(),
    });
    return result;
  }

  @Get(":productId")
  @Roles("customer", "admin")
  async getStock(@Param("productId") productId: string) {
    return this.inventoryAdmin.getStock(productId);
  }
}
