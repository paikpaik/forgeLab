import { Module } from "@nestjs/common";
import { DatabaseModule, DATABASE_DATA_SOURCE } from "@paikpaik/node-forge/database/nestjs";
import type { DataSource } from "typeorm";
import { createDatabaseHealthChecker } from "@paikpaik/node-forge/health";
import type { HealthChecker } from "@paikpaik/node-forge/health";
import { LoggerModule } from "@paikpaik/node-forge/logger/nestjs";
import type { LoggerOptions } from "@paikpaik/node-forge/logger";
import { MetricsModule } from "@paikpaik/node-forge/metrics/nestjs";
import { HealthModule } from "@paikpaik/node-forge/health/nestjs";
import { OrderEntity } from "./entities/order.entity";
import { HEALTH_CHECK_CACHE_MS } from "../shared/constants";
import { OrderModule } from "./order.module";

const logLevel = (process.env.LOG_LEVEL ?? "info") as NonNullable<LoggerOptions["level"]>;

@Module({
  imports: [
    LoggerModule.forRoot({ level: logLevel }),
    MetricsModule.forRoot({}),
    DatabaseModule.forRoot({
      type: "postgres",
      host: process.env.DB_HOST ?? "localhost",
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USER ?? "postgres",
      password: process.env.DB_PASSWORD ?? "postgres",
      database: process.env.DB_NAME ?? "order_db",
      entities: [OrderEntity],
      synchronize: true, // 랩 전용, order-outbox와 동일한 타협
    }),
    HealthModule.forRootAsync({
      useFactory: (dataSource: unknown): Record<string, HealthChecker> => ({
        database: createDatabaseHealthChecker(dataSource as DataSource),
      }),
      inject: [DATABASE_DATA_SOURCE],
      cacheMs: HEALTH_CHECK_CACHE_MS,
    }),
    OrderModule,
  ],
})
export class OrderAppModule {}
