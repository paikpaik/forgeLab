import { Module } from "@nestjs/common";
import type { Kafka } from "kafkajs";
import { DatabaseModule, DATABASE_DATA_SOURCE } from "@paikpaik/node-forge/database/nestjs";
import type { DataSource } from "typeorm";
import { createDatabaseHealthChecker } from "@paikpaik/node-forge/health";
import type { HealthChecker } from "@paikpaik/node-forge/health";
import { LoggerModule } from "@paikpaik/node-forge/logger/nestjs";
import type { LoggerOptions } from "@paikpaik/node-forge/logger";
import { MetricsModule } from "@paikpaik/node-forge/metrics/nestjs";
import { HealthModule } from "@paikpaik/node-forge/health/nestjs";
import { OrderEntity } from "../entities/order.entity";
import { OutboxRecordEntity } from "../entities/outbox-record.entity";
import { createKafkaHealthChecker } from "../shared/kafka-health";
import { HEALTH_CHECK_CACHE_MS, KAFKA_INSTANCE } from "../shared/constants";
import { KafkaClientModule } from "./kafka-client.module";
import { FulfillmentModule } from "./fulfillment.module";

const logLevel = (process.env.LOG_LEVEL ?? "info") as NonNullable<LoggerOptions["level"]>;

@Module({
  imports: [
    LoggerModule.forRoot({ level: logLevel }),
    MetricsModule.forRoot({}),
    // api 프로세스와 같은 Postgres를 보되, 여긴 order.status만 업데이트하므로 OutboxRecordEntity는
    // synchronize 대상에서 빼도 되지만 — 같은 DB의 같은 스키마를 보는 두 프로세스가 서로 다른
    // synchronize 결과를 만들면 혼란스러워서 동일하게 등록한다(둘 다 같은 테이블 집합을 봄).
    DatabaseModule.forRoot({
      type: "postgres",
      host: process.env.DB_HOST ?? "localhost",
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USER ?? "postgres",
      password: process.env.DB_PASSWORD ?? "postgres",
      database: process.env.DB_NAME ?? "order_outbox",
      entities: [OrderEntity, OutboxRecordEntity],
      synchronize: true,
    }),
    KafkaClientModule,
    HealthModule.forRootAsync({
      useFactory: (dataSource: unknown, kafka: unknown): Record<string, HealthChecker> => ({
        database: createDatabaseHealthChecker(dataSource as DataSource),
        kafka: createKafkaHealthChecker(kafka as Kafka),
      }),
      inject: [DATABASE_DATA_SOURCE, KAFKA_INSTANCE],
      cacheMs: HEALTH_CHECK_CACHE_MS,
    }),
    FulfillmentModule,
  ],
})
export class FulfillmentAppModule {}
