import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@paikpaik/node-forge/database/nestjs";
import type { DataSource } from "typeorm";
import { In } from "typeorm";
import { OrderEntity } from "../entities/order.entity";
import { OutboxRecordEntity } from "../entities/outbox-record.entity";
import { OrderCreated } from "../shared/order-created.contract";
import type { OrderCreatedPayload } from "../shared/order-created.contract";
import { OUTBOX_POISON_ITEM, OUTBOX_POISON_TOPIC } from "../shared/constants";
import { AdminEventsService } from "../shared/admin-events.service";
import { OrdersMetrics } from "./orders.metrics";
import type { CreateOrderDto } from "./dto/create-order.dto";

export type OrderStage = "created" | "published" | "confirmed";

export interface OrderView {
  id: string;
  item: string;
  amount: number;
  stage: OrderStage;
  createdAt: string;
  // 폴링이 "발행됨" 상태를 실시간으로 못 잡아도(카프카 발행→소비가 폴링 주기보다 짧게
  // 끝나버려서), 클라이언트가 이 실제 시각들로 지나간 전이를 정확히 재구성할 수 있게 한다.
  publishedAt: string | null;
  confirmedAt: string | null;
}

@Injectable()
export class OrdersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly metrics: OrdersMetrics,
    private readonly adminEvents: AdminEventsService,
  ) {}

  // 주문 저장과 outbox row 저장을 하나의 DB 트랜잭션으로 묶는다 — 이게 이 실험의 핵심이다.
  // 둘 중 하나만 커밋되는 경우(DB는 있는데 이벤트가 안 나가거나, 반대로 이벤트만 나가고 DB엔
  // 없는 경우)가 원천적으로 생길 수 없다. 실제 Kafka 발행은 여기서 하지 않는다 —
  // OutboxPublisherService가 별도로 폴링해서 발행한다(트랜잭션 커밋과 발행 사이의 지연이
  // 이 패턴의 트레이드오프).
  async create(dto: CreateOrderDto): Promise<{ id: string }> {
    const id = await this.dataSource.transaction(async (manager) => {
      const order = await manager.save(OrderEntity, {
        id: randomUUID(),
        item: dto.item,
        amount: dto.amount,
      });

      const payload: OrderCreatedPayload = {
        orderId: order.id,
        item: order.item,
        amount: order.amount,
        createdAt: order.createdAt.toISOString(),
      };

      await manager.save(OutboxRecordEntity, {
        id: randomUUID(),
        // panel.html의 "발행 실패 유발" 버튼이 이 상품명으로 주문하면, 일부러 유효하지 않은
        // 토픽을 넣어서 OutboxPublisher의 markFailed/dead-lettering이 실제로 동작하는지
        // raw SQL 없이도 확인할 수 있게 한다 — 정상 흐름과는 무관한 테스트/데모 전용 분기.
        topic: dto.item === OUTBOX_POISON_ITEM ? OUTBOX_POISON_TOPIC : OrderCreated.topic,
        key: order.id,
        payload,
        publishedAt: null,
      });

      return order.id;
    });

    this.metrics.ordersCreatedTotal.inc();
    this.adminEvents.emit("created", `주문 생성 — ${dto.item} x${dto.amount} (id ${id.slice(0, 8)}…)`);
    return { id };
  }

  async findAll(limit = 20): Promise<OrderView[]> {
    const orders = await this.dataSource.getRepository(OrderEntity).find({
      order: { createdAt: "DESC" },
      take: limit,
    });
    return this.toViews(orders);
  }

  async findOne(id: string): Promise<OrderView | null> {
    const order = await this.dataSource.getRepository(OrderEntity).findOne({ where: { id } });
    if (!order) return null;
    return (await this.toViews([order]))[0];
  }

  private async toViews(orders: OrderEntity[]): Promise<OrderView[]> {
    if (orders.length === 0) return [];

    const outboxRows = await this.dataSource.getRepository(OutboxRecordEntity).find({
      where: { topic: OrderCreated.topic, key: In(orders.map((order) => order.id)) },
    });
    const publishedAtByOrderId = new Map(outboxRows.map((row) => [row.key, row.publishedAt]));

    return orders.map((order) => {
      const publishedAt = publishedAtByOrderId.get(order.id) ?? null;
      return {
        id: order.id,
        item: order.item,
        amount: order.amount,
        stage: this.computeStage(order, publishedAt),
        createdAt: order.createdAt.toISOString(),
        publishedAt,
        confirmedAt: order.confirmedAt,
      };
    });
  }

  private computeStage(order: OrderEntity, publishedAt: string | null): OrderStage {
    if (order.status === "confirmed") return "confirmed";
    if (publishedAt) return "published";
    return "created";
  }
}
