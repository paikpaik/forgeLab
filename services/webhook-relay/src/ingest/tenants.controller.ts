import { Body, Controller, Post, UseInterceptors } from "@nestjs/common";
import { ResponseInterceptor } from "@paikpaik/node-forge/response/nestjs";
import { TenantsService } from "./tenants.service";
import { CreateTenantDto } from "./dto/create-tenant.dto";

// 테넌트 생성은 최종 고객이 호출하는 API가 아니라 이 랩을 운영/검증하는 사람이 하는
// 온보딩 작업이라 admin/test 네이밍 컨벤션(/admin/*)을 적용한다.
@Controller("admin/tenants")
@UseInterceptors(ResponseInterceptor)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  create(@Body() dto: CreateTenantDto): Promise<{ id: string; apiKey: string }> {
    return this.tenantsService.create(dto);
  }
}
