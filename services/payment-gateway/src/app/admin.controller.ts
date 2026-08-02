import { Body, Controller, Get, Param, Post, UseInterceptors } from "@nestjs/common";
import { ResponseInterceptor } from "@paikpaik/node-forge/response/nestjs";
import { ForgeBizError } from "@paikpaik/node-forge/core";
import { PaymentService } from "./payment.service";

// 강제 재조회/DEAD 확인/fake-pg flakiness 조절처럼 실사용자가 아니라 운영자·테스트 도구가
// 쓰는 API라 컨벤션대로 /admin/* 프리픽스 아래 둔다.
@Controller("admin/payments")
@UseInterceptors(ResponseInterceptor)
export class AdminController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get("dead")
  listDead() {
    return this.paymentService.listDead();
  }

  @Get("in-doubt")
  listInDoubt() {
    return this.paymentService.listInDoubt();
  }

  @Post(":id/reconcile")
  async reconcile(@Param("id") id: string): Promise<{ reconciled: boolean }> {
    const reconciled = await this.paymentService.reconcile(id);
    return { reconciled };
  }

  @Get("fake-pg/config")
  getFakePgConfig() {
    return this.paymentService.proxyGetFakePgConfig();
  }

  @Post("fake-pg/config")
  setFakePgConfig(@Body() config: Record<string, number>) {
    if (typeof config !== "object" || config === null) {
      throw new ForgeBizError("E9400", "잘못된 설정 값입니다");
    }
    return this.paymentService.proxySetFakePgConfig(config);
  }
}
