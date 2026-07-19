import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
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
import { OrdersModule } from "./orders.module";

const logLevel = (process.env.LOG_LEVEL ?? "info") as NonNullable<LoggerOptions["level"]>;

@Module({
  imports: [
    LoggerModule.forRoot({ level: logLevel }),
    MetricsModule.forRoot({}),
    ScheduleModule.forRoot(),
    DatabaseModule.forRoot({
      type: "postgres",
      host: process.env.DB_HOST ?? "localhost",
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USER ?? "postgres",
      password: process.env.DB_PASSWORD ?? "postgres",
      database: process.env.DB_NAME ?? "order_outbox",
      entities: [OrderEntity, OutboxRecordEntity],
      // 랩 환경 전용 — 마이그레이션 도구 없이 엔티티로 테이블을 자동 생성한다. 실 서비스라면
      // 스키마가 예고 없이 바뀔 수 있어 지양해야 하는 설정이지만, 실험 목적엔 이 정도로 충분하다.
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
    OrdersModule,
  ],
})
export class ApiAppModule {}
