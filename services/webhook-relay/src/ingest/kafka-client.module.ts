import { Global, Module } from "@nestjs/common";
import { Kafka } from "kafkajs";
import { KAFKA_CLIENT_ID_INGEST, KAFKA_INSTANCE } from "../shared/constants";

@Global()
@Module({
  providers: [
    {
      provide: KAFKA_INSTANCE,
      useFactory: () =>
        new Kafka({
          clientId: KAFKA_CLIENT_ID_INGEST,
          brokers: (process.env.KAFKA_BROKERS ?? "localhost:29094").split(","),
        }),
    },
  ],
  exports: [KAFKA_INSTANCE],
})
export class KafkaClientModule {}
