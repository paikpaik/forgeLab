import { Module } from "@nestjs/common";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { OrdersMetrics } from "./orders.metrics";
import { TypeormOutboxStore } from "./typeorm-outbox-store";
import { OutboxPublisherService } from "./outbox-publisher.service";
import { OutboxController } from "./outbox.controller";

@Module({
  controllers: [OrdersController, OutboxController],
  providers: [OrdersService, OrdersMetrics, TypeormOutboxStore, OutboxPublisherService],
})
export class OrdersModule {}
