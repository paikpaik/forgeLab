import { Body, Controller, Get, Param, Post, UseInterceptors } from "@nestjs/common";
import { ResponseInterceptor } from "@paikpaik/node-forge/response/nestjs";
import { ApiVersion } from "@paikpaik/node-forge/versioning/nestjs";
import type { VersionResolution } from "@paikpaik/node-forge/versioning";
import { PaymentService } from "./payment.service";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { API_VERSION_OPTIONS } from "../shared/constants";

@Controller("payments")
@UseInterceptors(ResponseInterceptor)
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post()
  create(@Body() dto: CreatePaymentDto, @ApiVersion(API_VERSION_OPTIONS) version: VersionResolution) {
    return this.paymentService.createPayment(dto, version.resolved as "v1" | "v2");
  }

  @Get(":id")
  get(@Param("id") id: string, @ApiVersion(API_VERSION_OPTIONS) version: VersionResolution) {
    return this.paymentService.getPayment(id, version.resolved as "v1" | "v2");
  }

  // v1/v2 응답 모두 시도 이력까지는 안 담는다(가맹점 콘솔이 클릭해서 펼치는 상세 화면용) —
  // webhook-relay의 "엔드포인트 클릭 → 배달 타임라인"과 같은 패턴.
  @Get(":id/attempts")
  attempts(@Param("id") id: string) {
    return this.paymentService.listAttempts(id);
  }
}
