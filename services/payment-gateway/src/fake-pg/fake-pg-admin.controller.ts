import { Body, Controller, Get, Post } from "@nestjs/common";
import { FakePgService } from "./fake-pg.service";
import { FakePgConfigDto } from "./dto/fake-pg-config.dto";

// 테스트 도구 전용 — 컨벤션대로 /admin/* 프리픽스. payment-gateway의 admin.controller.ts가
// 이 API를 프록시해서 panel.html이 fake-pg 포트를 몰라도 되게 한다.
@Controller("admin/fake-pg")
export class FakePgAdminController {
  constructor(private readonly fakePg: FakePgService) {}

  @Get("config")
  getConfig() {
    return this.fakePg.getConfig();
  }

  @Post("config")
  setConfig(@Body() dto: FakePgConfigDto) {
    return this.fakePg.setConfig(dto);
  }
}
