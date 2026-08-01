import { Controller, Get, Param, Post, UseInterceptors } from "@nestjs/common";
import { ResponseInterceptor } from "@paikpaik/node-forge/response/nestjs";
import { ForgeBizError } from "@paikpaik/node-forge/core";
import { TypeormOutboxStore } from "./typeorm-outbox-store";
import type { DeadOutboxRecord } from "./typeorm-outbox-store";

// 발행이 영구히 실패한(dead-lettered) outbox 레코드를 확인·복구하기 위한 엔드포인트 — 이게
// 없으면 markFailed로 조용히 격리만 되고 아무도 그 사실을 볼 수 없다(live-ranking의 DLQ
// 로그와 같은 이유). revive는 확인에서 한 걸음 더 나간 대응 수단 — 관측만 되고 되살릴
// 방법이 없다는 게 이 실험의 오래된 P0였다.
@Controller("admin/outbox")
@UseInterceptors(ResponseInterceptor)
export class OutboxController {
  constructor(private readonly outboxStore: TypeormOutboxStore) {}

  @Get("dead")
  getDead(): Promise<{ count: number; recent: DeadOutboxRecord[] }> {
    return this.outboxStore.listDead();
  }

  @Post("dead/:id/revive")
  async revive(@Param("id") id: string): Promise<{ revived: boolean }> {
    const result = await this.outboxStore.revive(id);
    if (!result.revived) {
      throw new ForgeBizError("E9404", "죽은 레코드를 찾을 수 없습니다");
    }
    return result;
  }
}
