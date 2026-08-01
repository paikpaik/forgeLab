import { Controller, Get, UseInterceptors } from "@nestjs/common";
import { ResponseInterceptor } from "@paikpaik/node-forge/response/nestjs";
import { TypeormOutboxStore } from "./typeorm-outbox-store";
import type { DeadOutboxRecord } from "./typeorm-outbox-store";

// 발행이 영구히 실패한(dead-lettered) outbox 레코드를 확인하기 위한 엔드포인트 — 이게
// 없으면 markFailed로 조용히 격리만 되고 아무도 그 사실을 볼 수 없다(live-ranking의 DLQ
// 로그와 같은 이유).
@Controller("admin/outbox")
@UseInterceptors(ResponseInterceptor)
export class OutboxController {
  constructor(private readonly outboxStore: TypeormOutboxStore) {}

  @Get("dead")
  getDead(): Promise<{ count: number; recent: DeadOutboxRecord[] }> {
    return this.outboxStore.listDead();
  }
}
