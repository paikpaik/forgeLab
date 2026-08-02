import { Module } from "@nestjs/common";
import { AdminEventsModule } from "@paikpaik/node-forge/events/nestjs";
import { OrderCreatedConsumer } from "./order-created.consumer";

@Module({
  imports: [AdminEventsModule.forRoot({ path: "admin/logs" })],
  providers: [OrderCreatedConsumer],
})
export class FulfillmentModule {}
