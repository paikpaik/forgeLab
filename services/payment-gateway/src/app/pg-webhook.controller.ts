import { Body, Controller, Post } from "@nestjs/common";
import { PaymentService } from "./payment.service";
import { PgCallbackDto } from "./dto/pg-callback.dto";

// fake-pg가 비동기(202 접수) 거래의 최종 결과를 알려줄 때 호출하는 콜백 수신 엔드포인트.
// fake-pg는 우리 응답 포맷을 모르는 "외부 시스템"이라 ApiResponse 봉투를 안 쓴다.
@Controller("webhooks")
export class PgWebhookController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post("pg-callback")
  callback(@Body() dto: PgCallbackDto) {
    return this.paymentService.handleWebhookCallback(dto);
  }
}
