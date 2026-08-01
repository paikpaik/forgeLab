import { Body, Controller, Get, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { ResponseInterceptor } from "@paikpaik/node-forge/response/nestjs";
import { EndpointsService } from "./endpoints.service";
import { CreateEndpointDto } from "./dto/create-endpoint.dto";
import { CurrentTenant, TenantAuthGuard } from "./tenant-auth.guard";
import type { TenantEntity } from "../entities/tenant.entity";
import type { EndpointEntity } from "../entities/endpoint.entity";

@Controller("endpoints")
@UseInterceptors(ResponseInterceptor)
@UseGuards(TenantAuthGuard)
export class EndpointsController {
  constructor(private readonly endpointsService: EndpointsService) {}

  @Post()
  create(@CurrentTenant() tenant: TenantEntity, @Body() dto: CreateEndpointDto): Promise<EndpointEntity> {
    return this.endpointsService.create(tenant.id, dto);
  }

  @Get()
  list(@CurrentTenant() tenant: TenantEntity): Promise<EndpointEntity[]> {
    return this.endpointsService.list(tenant.id);
  }
}
