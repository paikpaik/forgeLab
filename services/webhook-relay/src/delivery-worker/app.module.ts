import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import type { Kafka } from "kafkajs";
import { DatabaseModule, DATABASE_DATA_SOURCE } from "@paikpaik/node-forge/database/nestjs";
import type { DataSource } from "typeorm";
import { RedisModule, REDIS_CLIENT } from "@paikpaik/node-forge/redis/nestjs";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import { createDatabaseHealthChecker, createRedisHealthChecker } from "@paikpaik/node-forge/health";
import type { HealthChecker } from "@paikpaik/node-forge/health";
import { LoggerModule } from "@paikpaik/node-forge/logger/nestjs";
import type { LoggerOptions } from "@paikpaik/node-forge/logger";
import { MetricsModule } from "@paikpaik/node-forge/metrics/nestjs";
import { HealthModule } from "@paikpaik/node-forge/health/nestjs";
import { DistributedCircuitBreaker } from "@paikpaik/node-forge/redis";
import { TenantEntity } from "../entities/tenant.entity";
import { EndpointEntity } from "../entities/endpoint.entity";
import { EventEntity } from "../entities/event.entity";
import { DeliveryEntity } from "../entities/delivery.entity";
import { DispatchOutboxRecordEntity } from "../entities/dispatch-outbox-record.entity";
import { createKafkaHealthChecker } from "../shared/kafka-health";
import {
  CIRCUIT_FAILURE_THRESHOLD,
  CIRCUIT_RESET_TIMEOUT_MS,
  HEALTH_CHECK_CACHE_MS,
  KAFKA_INSTANCE,
} from "../shared/constants";
import { KafkaClientModule } from "./kafka-client.module";
import { DeliveryAttemptService } from "./delivery-attempt.service";
import { DispatchConsumer } from "./dispatch.consumer";
import { RetryPollerService } from "./retry-poller.service";

const logLevel = (process.env.LOG_LEVEL ?? "info") as NonNullable<LoggerOptions["level"]>;
const redisOptions = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

@Module({
  imports: [
    LoggerModule.forRoot({ level: logLevel }),
    MetricsModule.forRoot({}),
    ScheduleModule.forRoot(),
    RedisModule.forRoot(redisOptions),
    DatabaseModule.forRoot({
      type: "postgres",
      host: process.env.DB_HOST ?? "localhost",
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USER ?? "postgres",
      password: process.env.DB_PASSWORD ?? "postgres",
      database: process.env.DB_NAME ?? "webhook_relay",
      // delivery-worker는 dispatch outbox를 안 씀(ingest 전용)이지만, 같은 Postgres의 같은
      // 스키마를 보는 두 프로세스가 synchronize 결과를 다르게 만들면 혼란스러워서 order-outbox의
      // api/fulfillment와 동일하게 엔티티 전체를 동일하게 등록한다.
      entities: [TenantEntity, EndpointEntity, EventEntity, DeliveryEntity, DispatchOutboxRecordEntity],
      synchronize: true,
    }),
    KafkaClientModule,
    HealthModule.forRootAsync({
      useFactory: (dataSource: unknown, kafka: unknown, redisClient: unknown): Record<string, HealthChecker> => ({
        database: createDatabaseHealthChecker(dataSource as DataSource),
        kafka: createKafkaHealthChecker(kafka as Kafka),
        redis: createRedisHealthChecker(redisClient as ForgeRedisClient),
      }),
      inject: [DATABASE_DATA_SOURCE, KAFKA_INSTANCE, REDIS_CLIENT],
      cacheMs: HEALTH_CHECK_CACHE_MS,
    }),
  ],
  providers: [
    // ingest/app.module.ts와 동일한 이유(생성자가 (redis, options) plain constructor라
    // NestJS가 자동 조립 못 함)로 useFactory 등록.
    {
      provide: DistributedCircuitBreaker,
      useFactory: (redis: ForgeRedisClient) =>
        new DistributedCircuitBreaker(redis, {
          failureThreshold: CIRCUIT_FAILURE_THRESHOLD,
          resetTimeout: CIRCUIT_RESET_TIMEOUT_MS,
        }),
      inject: [REDIS_CLIENT],
    },
    DeliveryAttemptService,
    DispatchConsumer,
    RetryPollerService,
  ],
})
export class DeliveryWorkerAppModule {}
