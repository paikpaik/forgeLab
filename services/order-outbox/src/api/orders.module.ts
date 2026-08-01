import { Module } from "@nestjs/common";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { OrdersMetrics } from "./orders.metrics";
import { TypeormOutboxStore } from "./typeorm-outbox-store";
import { OutboxPublisherService } from "./outbox-publisher.service";
import { OutboxController } from "./outbox.controller";
import { AdminEventsService } from "../shared/admin-events.service";
import { AdminLogsController } from "../shared/admin-logs.controller";

@Module({
  controllers: [OrdersController, OutboxController, AdminLogsController],
  providers: [OrdersService, OrdersMetrics, TypeormOutboxStore, OutboxPublisherService, AdminEventsService],
})
export class OrdersModule {}
