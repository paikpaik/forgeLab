import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { ResponseInterceptor } from "@paikpaik/node-forge/response/nestjs";
import { EventsService } from "./events.service";
import type { DeliveryView } from "./events.service";
import { PublishEventDto } from "./dto/publish-event.dto";
import { CurrentTenant, TenantAuthGuard } from "./tenant-auth.guard";
import type { TenantEntity } from "../entities/tenant.entity";

@Controller()
@UseInterceptors(ResponseInterceptor)
@UseGuards(TenantAuthGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post("events")
  publish(
    @CurrentTenant() tenant: TenantEntity,
    @Body() dto: PublishEventDto,
  ): Promise<{ eventId: string; deliveryIds: string[] }> {
    return this.eventsService.publish(tenant.id, dto);
  }

  @Get("events/:id/deliveries")
  listDeliveries(@Param("id") id: string): Promise<DeliveryView[]> {
    return this.eventsService.listDeliveries(id);
  }
}
