import { Module } from "@nestjs/common";
import type { Kafka } from "kafkajs";
import { RedisModule, REDIS_CLIENT } from "@paikpaik/node-forge/redis/nestjs";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import { LoggerModule } from "@paikpaik/node-forge/logger/nestjs";
import type { LoggerOptions } from "@paikpaik/node-forge/logger";
import { MetricsModule } from "@paikpaik/node-forge/metrics/nestjs";
import { HealthModule } from "@paikpaik/node-forge/health/nestjs";
import { createRedisHealthChecker } from "@paikpaik/node-forge/health";
import type { HealthChecker } from "@paikpaik/node-forge/health";
import { createKafkaHealthChecker } from "../shared/kafka-health";
import { KAFKA_INSTANCE } from "../shared/constants";
import { KafkaClientModule } from "./kafka-client.module";
import { AggregatorModule } from "./aggregator.module";

const redisOptions = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

const logLevel = (process.env.LOG_LEVEL ?? "info") as NonNullable<LoggerOptions["level"]>;

@Module({
  imports: [
    LoggerModule.forRoot({ level: logLevel }),
    MetricsModule.forRoot({}),
    RedisModule.forRoot(redisOptions),
    KafkaClientModule,
    HealthModule.forRootAsync({
      useFactory: (redisClient: unknown, kafka: unknown): Record<string, HealthChecker> => ({
        redis: createRedisHealthChecker(redisClient as ForgeRedisClient),
        kafka: createKafkaHealthChecker(kafka as Kafka),
      }),
      inject: [REDIS_CLIENT, KAFKA_INSTANCE],
    }),
    AggregatorModule,
  ],
})
export class AggregatorAppModule {}
