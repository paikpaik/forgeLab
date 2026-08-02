import { Module } from "@nestjs/common";
import { AdminEventsModule } from "@paikpaik/node-forge/events/nestjs";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { OrdersMetrics } from "./orders.metrics";
import { TypeormOutboxStore } from "./typeorm-outbox-store";
import { OutboxPublisherService } from "./outbox-publisher.service";
import { OutboxController } from "./outbox.controller";

@Module({
  imports: [AdminEventsModule.forRoot({ path: "admin/logs" })],
  controllers: [OrdersController, OutboxController],
  providers: [OrdersService, OrdersMetrics, TypeormOutboxStore, OutboxPublisherService],
})
export class OrdersModule {}
