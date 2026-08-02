import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { FakePgService } from "./fake-pg.service";
import { ChargeRequestDto } from "./dto/charge-request.dto";

// 실제 외부 PG API를 흉내낸다 — 우리 자체 ApiResponse<T> 봉투를 쓰지 않는다(실제 PG는
// 자기 응답 스키마를 그대로 주지, 우리 컨벤션을 알 리 없다). payment-gateway 쪽
// PaymentService가 이 raw 응답을 그대로 파싱한다.
@Controller("pg")
export class FakePgController {
  constructor(private readonly fakePg: FakePgService) {}

  @Post("charge")
  charge(@Body() dto: ChargeRequestDto) {
    return this.fakePg.charge(dto.clientReference, dto.amount);
  }

  @Get("charge/by-reference/:ref")
  byReference(@Param("ref") ref: string) {
    return this.fakePg.inquireByReference(ref);
  }

  @Get("charge/:pgTransactionId")
  byId(@Param("pgTransactionId") pgTransactionId: string) {
    return this.fakePg.inquireById(pgTransactionId);
  }
}
