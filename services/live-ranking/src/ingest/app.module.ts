import { Module } from "@nestjs/common";
import type { Kafka } from "kafkajs";
import type { HealthChecker } from "@paikpaik/node-forge/health";
import { LoggerModule } from "@paikpaik/node-forge/logger/nestjs";
import type { LoggerOptions } from "@paikpaik/node-forge/logger";
import { MetricsModule } from "@paikpaik/node-forge/metrics/nestjs";
import { HealthModule } from "@paikpaik/node-forge/health/nestjs";
import { createKafkaHealthChecker } from "../shared/kafka-health";
import { HEALTH_CHECK_CACHE_MS, KAFKA_INSTANCE } from "../shared/constants";
import { KafkaClientModule } from "./kafka-client.module";
import { IngestModule } from "./ingest.module";

const logLevel = (process.env.LOG_LEVEL ?? "info") as NonNullable<LoggerOptions["level"]>;

@Module({
  imports: [
    LoggerModule.forRoot({ level: logLevel }),
    MetricsModule.forRoot({}),
    KafkaClientModule,
    HealthModule.forRootAsync({
      useFactory: (kafka: unknown): Record<string, HealthChecker> => ({
        kafka: createKafkaHealthChecker(kafka as Kafka),
      }),
      inject: [KAFKA_INSTANCE],
      cacheMs: HEALTH_CHECK_CACHE_MS,
    }),
    IngestModule,
  ],
})
export class IngestAppModule {}
