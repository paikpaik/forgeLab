import { Module } from "@nestjs/common";
import { DatabaseModule, DATABASE_DATA_SOURCE } from "@paikpaik/node-forge/database/nestjs";
import type { DataSource } from "typeorm";
import { createDatabaseHealthChecker, createRedisHealthChecker } from "@paikpaik/node-forge/health";
import type { HealthChecker } from "@paikpaik/node-forge/health";
import { LoggerModule } from "@paikpaik/node-forge/logger/nestjs";
import type { LoggerOptions } from "@paikpaik/node-forge/logger";
import { MetricsModule } from "@paikpaik/node-forge/metrics/nestjs";
import { HealthModule } from "@paikpaik/node-forge/health/nestjs";
import { RedisModule, REDIS_CLIENT } from "@paikpaik/node-forge/redis/nestjs";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import { PaymentTransactionEntity } from "./entities/payment-transaction.entity";
import { PaymentAttemptEntity } from "./entities/payment-attempt.entity";
import { PaymentModule } from "./payment.module";

const logLevel = (process.env.LOG_LEVEL ?? "info") as NonNullable<LoggerOptions["level"]>;
const redisOptions = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

@Module({
  imports: [
    LoggerModule.forRoot({ level: logLevel }),
    MetricsModule.forRoot({}),
    // HealthModule의 redis 체커가 쓸 REDIS_CLIENT를 루트에서도 등록한다(PaymentModule의
    // RedisModule과는 별개 인스턴스가 되지만 같은 host:port라 문제 없음 — live-auction과 동일 타협).
    RedisModule.forRoot(redisOptions),
    DatabaseModule.forRoot({
      type: "postgres",
      host: process.env.DB_HOST ?? "localhost",
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USER ?? "postgres",
      password: process.env.DB_PASSWORD ?? "postgres",
      database: process.env.DB_NAME ?? "payment_gateway",
      entities: [PaymentTransactionEntity, PaymentAttemptEntity],
      synchronize: true, // 랩 전용, 다른 실험과 동일한 타협
    }),
    HealthModule.forRootAsync({
      useFactory: (dataSource: unknown, redisClient: unknown): Record<string, HealthChecker> => ({
        database: createDatabaseHealthChecker(dataSource as DataSource),
        redis: createRedisHealthChecker(redisClient as ForgeRedisClient),
      }),
      inject: [DATABASE_DATA_SOURCE, REDIS_CLIENT],
    }),
    PaymentModule,
  ],
})
export class AppModule {}
