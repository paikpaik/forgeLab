import { Module } from "@nestjs/common";
import { OrderCreatedConsumer } from "./order-created.consumer";
import { AdminEventsService } from "../shared/admin-events.service";
import { AdminLogsController } from "../shared/admin-logs.controller";

@Module({
  controllers: [AdminLogsController],
  providers: [OrderCreatedConsumer, AdminEventsService],
})
export class FulfillmentModule {}
