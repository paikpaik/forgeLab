import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { SAGA_POLL_BATCH_SIZE, SAGA_POLL_INTERVAL_MS } from "../shared/constants";
import { SagaService } from "./saga.service";

@Injectable()
export class SagaProcessorService {
  private readonly logger = new Logger(SagaProcessorService.name);

  constructor(private readonly sagaService: SagaService) {}

  @Interval(SAGA_POLL_INTERVAL_MS)
  async tick(): Promise<void> {
    const pending = await this.sagaService.fetchPending(SAGA_POLL_BATCH_SIZE);

    for (const saga of pending) {
      // saga 하나가 실패해도(네트워크 오류 등) 나머지 saga는 계속 진행돼야 한다 — 이게 바로
      // kafka-forge OutboxPublisher가 겪었던 "배치 중 하나 실패 시 전체 중단" 버그를 재현하지
      // 않기 위한 핵심 지점. per-saga try/catch로 격리한다.
      try {
        await this.sagaService.driveStep(saga);
      } catch (error) {
        this.logger.error(`saga=${saga.id} 처리 중 예외 (다음 tick에 재시도): ${(error as Error).message}`);
      }
    }
  }
}
