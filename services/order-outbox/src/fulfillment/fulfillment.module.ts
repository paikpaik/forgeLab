import { Module } from "@nestjs/common";
import { OrderCreatedConsumer } from "./order-created.consumer";

@Module({
  providers: [OrderCreatedConsumer],
})
export class FulfillmentModule {}
