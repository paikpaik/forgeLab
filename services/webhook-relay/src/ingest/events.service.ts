import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@paikpaik/node-forge/database/nestjs";
import type { DataSource } from "typeorm";
import { AdminEventBus } from "@paikpaik/node-forge/events";
import { ADMIN_EVENT_BUS } from "@paikpaik/node-forge/events/nestjs";
import { EventEntity } from "../entities/event.entity";
import { DeliveryEntity } from "../entities/delivery.entity";
import { DispatchOutboxRecordEntity } from "../entities/dispatch-outbox-record.entity";
import { DispatchTrigger } from "../shared/dispatch-event.contract";
import type { AdminLogEvent } from "../shared/admin-log-event";
import { EndpointsService } from "./endpoints.service";
import type { PublishEventDto } from "./dto/publish-event.dto";

export interface DeliveryView {
  id: string;
  endpointId: string;
  status: string;
  attempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  responseStatus: number | null;
}

@Injectable()
export class EventsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly endpointsService: EndpointsService,
    @Inject(ADMIN_EVENT_BUS) private readonly adminEvents: AdminEventBus<AdminLogEvent>,
  ) {}

  // 이 실험의 핵심 — event 저장과 fan-out된 delivery/outbox row 저장을 하나의 DB 트랜잭션으로
  // 묶는다(order-outbox와 같은 원리, 코드는 새로 구현). "이벤트는 생성됐는데 일부 구독자에게만
  // 배달 시도 기록이 생긴다"거나 "outbox row가 안 만들어져서 영원히 발행 안 된다"는 경우가
  // 원천적으로 생길 수 없다.
  async publish(tenantId: string, dto: PublishEventDto): Promise<{ eventId: string; deliveryIds: string[] }> {
    const matching = await this.endpointsService.findMatching(tenantId, dto.type);

    const eventId = randomUUID();
    const deliveryIds = await this.dataSource.transaction(async (manager) => {
      await manager.save(EventEntity, { id: eventId, tenantId, type: dto.type, payload: dto.payload });

      const ids: string[] = [];
      for (const endpoint of matching) {
        const deliveryId = randomUUID();
        await manager.save(DeliveryEntity, {
          id: deliveryId,
          eventId,
          endpointId: endpoint.id,
          tenantId,
          status: "pending",
          attempts: 0,
          nextAttemptAt: null,
          lastAttemptAt: null,
          lastError: null,
          responseStatus: null,
        });
        await manager.save(DispatchOutboxRecordEntity, {
          id: randomUUID(),
          topic: DispatchTrigger.topic,
          key: deliveryId,
          payload: { deliveryId },
          publishedAt: null,
        });
        ids.push(deliveryId);
      }
      return ids;
    });

    this.adminEvents.emit({
      type: "fanned_out",
      message: `이벤트 발행 — ${dto.type} → 구독 엔드포인트 ${deliveryIds.length}개로 fan-out`,
      at: new Date().toISOString(),
    });

    return { eventId, deliveryIds };
  }

  async listDeliveries(eventId: string): Promise<DeliveryView[]> {
    const rows = await this.dataSource.getRepository(DeliveryEntity).find({ where: { eventId } });
    return rows.map((row) => ({
      id: row.id,
      endpointId: row.endpointId,
      status: row.status,
      attempts: row.attempts,
      nextAttemptAt: row.nextAttemptAt,
      lastAttemptAt: row.lastAttemptAt,
      lastError: row.lastError,
      responseStatus: row.responseStatus,
    }));
  }
}
