import { Global, Module } from "@nestjs/common";
import { Kafka } from "kafkajs";
import { KAFKA_CLIENT_ID_FULFILLMENT, KAFKA_INSTANCE } from "../shared/constants";

@Global()
@Module({
  providers: [
    {
      provide: KAFKA_INSTANCE,
      useFactory: () =>
        new Kafka({
          clientId: KAFKA_CLIENT_ID_FULFILLMENT,
          brokers: (process.env.KAFKA_BROKERS ?? "localhost:29093").split(","),
        }),
    },
  ],
  exports: [KAFKA_INSTANCE],
})
export class KafkaClientModule {}
