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
import { AdminEventsModule } from "@paikpaik/node-forge/events/nestjs";
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
import { TenantsController } from "./tenants.controller";
import { TenantsService } from "./tenants.service";
import { EndpointsController } from "./endpoints.controller";
import { EndpointsService } from "./endpoints.service";
import { EventsController } from "./events.controller";
import { EventsService } from "./events.service";
import { AdminController } from "./admin.controller";
import { DispatchOutboxStore } from "./dispatch-outbox-store";
import { OutboxPublisherService } from "./outbox-publisher.service";

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
    AdminEventsModule.forRoot({ path: "admin/logs" }),
    DatabaseModule.forRoot({
      type: "postgres",
      host: process.env.DB_HOST ?? "localhost",
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USER ?? "postgres",
      password: process.env.DB_PASSWORD ?? "postgres",
      database: process.env.DB_NAME ?? "webhook_relay",
      entities: [TenantEntity, EndpointEntity, EventEntity, DeliveryEntity, DispatchOutboxRecordEntity],
      // 랩 환경 전용 — 마이그레이션 도구 없이 엔티티로 테이블을 자동 생성한다.
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
  controllers: [TenantsController, EndpointsController, EventsController, AdminController],
  providers: [
    TenantsService,
    EndpointsService,
    EventsService,
    DispatchOutboxStore,
    OutboxPublisherService,
    // DistributedCircuitBreaker(node-forge 1.0.10)는 생성자가 (redis, options) plain
    // constructor라 @InjectRedis() 같은 파라미터 데코레이터가 없다 — NestJS가 자동으로
    // 조립 못 하므로 useFactory로 직접 만들어서 등록한다. 로컬 RedisCircuitBreaker는
    // 이걸로 완전히 대체하고 삭제했다.
    {
      provide: DistributedCircuitBreaker,
      useFactory: (redis: ForgeRedisClient) =>
        new DistributedCircuitBreaker(redis, {
          failureThreshold: CIRCUIT_FAILURE_THRESHOLD,
          resetTimeout: CIRCUIT_RESET_TIMEOUT_MS,
        }),
      inject: [REDIS_CLIENT],
    },
  ],
})
export class IngestAppModule {}
