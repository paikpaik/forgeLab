import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Kafka } from "kafkajs";
import { InjectDataSource } from "@paikpaik/node-forge/database/nestjs";
import type { DataSource } from "typeorm";
import { StandardConsumer } from "@paikpaik/kafka-forge";
import { FULFILLMENT_CONSUMER_GROUP_ID, KAFKA_INSTANCE } from "../shared/constants";
import { OrderCreated } from "../shared/order-created.contract";
import { OrderEntity } from "../entities/order.entity";
import { AdminEventsService } from "../shared/admin-events.service";

// 다운스트림(예: 실제였다면 배송/알림 담당 팀)이 주문 생성 이벤트를 구독해서 "처리 완료"로
// 표시하는 역할만 시뮬레이션한다. idempotencyStore를 안 붙인 이유: order.status를
// 'confirmed'로 세팅하는 건 그 자체로 이미 멱등적인 연산이라(같은 값으로 여러 번 UPDATE해도
// 결과가 같음) 별도 dedup이 없어도 재배달에 안전하다 — live-ranking의 zincrby(누적, 비멱등)와
// 대비되는 지점.
@Injectable()
export class OrderCreatedConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderCreatedConsumer.name);
  private readonly consumer: StandardConsumer;

  constructor(
    @Inject(KAFKA_INSTANCE) kafka: Kafka,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly adminEvents: AdminEventsService,
  ) {
    this.consumer = new StandardConsumer(kafka, FULFILLMENT_CONSUMER_GROUP_ID);
  }

  async onModuleInit(): Promise<void> {
    await this.consumer.connect();

    await this.consumer.subscribe(OrderCreated, async (payload) => {
      // confirmedAt이 이미 있으면(= 한 번 확인된 적 있으면) 갱신하지 않는다 — 재배달돼서
      // 이 핸들러가 또 실행돼도 "최초로 확인된 시각"이 재배달 시각으로 덮여쓰이지 않게.
      const result = await this.dataSource
        .createQueryBuilder()
        .update(OrderEntity)
        .set({ status: "confirmed", confirmedAt: new Date().toISOString() })
        .where("id = :id", { id: payload.orderId })
        .andWhere("confirmedAt IS NULL")
        .execute();

      // affected === 0이면 재배달로 이미 확인된 주문을 또 받은 것 — 로그를 또 남기지 않는다.
      if (result.affected) {
        this.adminEvents.emit("confirmed", `주문 확인됨 — ${payload.item} (id ${payload.orderId.slice(0, 8)}…)`);
      }
    });

    await this.consumer.run();
    this.logger.log(`구독 시작: ${OrderCreated.topic} (group=${FULFILLMENT_CONSUMER_GROUP_ID})`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect();
  }
}
