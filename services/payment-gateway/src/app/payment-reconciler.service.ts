import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { PaymentService } from "./payment.service";
import { RECONCILE_INTERVAL_MS } from "../shared/constants";

// IN_DOUBT(PG 응답을 못 받아 확정 못 지은) 거래를 주기적으로 거래조회해서 해소한다.
// order-outbox/msa-checkout의 폴러와 같은 패턴 — 각 거래는 서로 독립적이라 하나가 실패해도
// 나머지 처리에 영향 없게 try/catch로 격리한다.
@Injectable()
export class PaymentReconcilerService {
  private readonly logger = new Logger(PaymentReconcilerService.name);

  constructor(private readonly paymentService: PaymentService) {}

  @Interval(RECONCILE_INTERVAL_MS)
  async tick(): Promise<void> {
    const targets = await this.paymentService.listInDoubt();
    for (const payment of targets) {
      try {
        await this.paymentService.reconcile(payment.id);
      } catch (err) {
        this.logger.warn(`거래조회 실패 — ${payment.id}: ${(err as Error).message}`);
      }
    }
  }
}
