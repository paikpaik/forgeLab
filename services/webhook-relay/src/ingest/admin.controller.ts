import { randomUUID } from "node:crypto";
import { Controller, Get, Inject, Param, Post, UseInterceptors } from "@nestjs/common";
import { ResponseInterceptor } from "@paikpaik/node-forge/response/nestjs";
import { ForgeBizError } from "@paikpaik/node-forge/core";
import { InjectDataSource } from "@paikpaik/node-forge/database/nestjs";
import type { DataSource } from "typeorm";
import { AdminEventBus } from "@paikpaik/node-forge/events";
import { ADMIN_EVENT_BUS } from "@paikpaik/node-forge/events/nestjs";
import { DistributedCircuitBreaker } from "@paikpaik/node-forge/redis";
import { DeliveryEntity } from "../entities/delivery.entity";
import { DispatchOutboxRecordEntity } from "../entities/dispatch-outbox-record.entity";
import { DispatchTrigger } from "../shared/dispatch-event.contract";
import type { AdminLogEvent } from "../shared/admin-log-event";

@Controller("admin")
@UseInterceptors(ResponseInterceptor)
export class AdminController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly circuitBreaker: DistributedCircuitBreaker,
    @Inject(ADMIN_EVENT_BUS) private readonly adminEvents: AdminEventBus<AdminLogEvent>,
  ) {}

  @Get("deliveries/dead")
  async listDead(): Promise<{ count: number; recent: DeliveryEntity[] }> {
    const repo = this.dataSource.getRepository(DeliveryEntity);
    const [count, recent] = await Promise.all([
      repo.count({ where: { status: "dead" } }),
      repo.find({ where: { status: "dead" }, order: { updatedAt: "DESC" }, take: 20 }),
    ]);
    return { count, recent };
  }

  // "복구"는 재시도 카운터를 리셋하고 새 dispatch 트리거를 발행해서 즉시 재시도되게 한다 —
  // order-outbox의 revive와 같은 원리(관측만 되고 대응 수단이 없는 걸 막기 위함).
  @Post("deliveries/:id/replay")
  async replay(@Param("id") id: string): Promise<{ replayed: boolean }> {
    const repo = this.dataSource.getRepository(DeliveryEntity);
    const delivery = await repo.findOneBy({ id });
    if (!delivery || delivery.status !== "dead") {
      throw new ForgeBizError("E9404", "재발송할 dead 상태의 delivery를 찾을 수 없습니다");
    }

    await repo.update(id, { status: "pending", attempts: 0, nextAttemptAt: null, lastError: null });
    await this.dataSource.getRepository(DispatchOutboxRecordEntity).save({
      id: randomUUID(),
      topic: DispatchTrigger.topic,
      key: id,
      payload: { deliveryId: id },
      publishedAt: null,
    });

    this.adminEvents.emit({
      type: "replayed",
      message: `dead delivery 재발송 — id ${id.slice(0, 8)}…`,
      at: new Date().toISOString(),
    });
    return { replayed: true };
  }

  @Get("endpoints/:id/circuit")
  async circuitState(@Param("id") id: string): Promise<{ state: string }> {
    return { state: await this.circuitBreaker.getState(id) };
  }
}
