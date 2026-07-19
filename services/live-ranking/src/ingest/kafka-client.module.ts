import { Global, Module } from "@nestjs/common";
import { Kafka } from "kafkajs";
import { KAFKA_CLIENT_ID_INGEST, KAFKA_INSTANCE } from "../shared/constants";

// node-forge의 RedisModule과 같은 패턴 — @Global()로 등록해서 HealthModule 등 다른 모듈에서
// 별도 import 없이 KAFKA_INSTANCE를 주입받을 수 있게 한다.
@Global()
@Module({
  providers: [
    {
      provide: KAFKA_INSTANCE,
      useFactory: () =>
        new Kafka({
          clientId: KAFKA_CLIENT_ID_INGEST,
          brokers: (process.env.KAFKA_BROKERS ?? "localhost:29092").split(","),
        }),
    },
  ],
  exports: [KAFKA_INSTANCE],
})
export class KafkaClientModule {}
