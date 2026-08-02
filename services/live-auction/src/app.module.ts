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
import { AuctionEntity } from "./auction/entities/auction.entity";
import { BidEntity } from "./auction/entities/bid.entity";
import { AuctionModule } from "./auction/auction.module";

const logLevel = (process.env.LOG_LEVEL ?? "info") as NonNullable<LoggerOptions["level"]>;
const redisOptions = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

@Module({
  imports: [
    LoggerModule.forRoot({ level: logLevel }),
    MetricsModule.forRoot({}),
    // HealthModule의 redis 체커가 쓸 REDIS_CLIENT는 루트에서도 한 번 더 등록해야 한다
    // (AuctionModule의 RedisModule과는 별개 인스턴스가 되지만, 둘 다 같은 host:port를
    // 바라보므로 커넥션 풀이 두 개 생기는 것 외에는 문제 없음 — 이 랩 규모에서는 무시 가능).
    RedisModule.forRoot(redisOptions),
    DatabaseModule.forRoot({
      type: "postgres",
      host: process.env.DB_HOST ?? "localhost",
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USER ?? "postgres",
      password: process.env.DB_PASSWORD ?? "postgres",
      database: process.env.DB_NAME ?? "live_auction",
      entities: [AuctionEntity, BidEntity],
      synchronize: true, // 랩 전용, 다른 실험과 동일한 타협
    }),
    HealthModule.forRootAsync({
      useFactory: (dataSource: unknown, redisClient: unknown): Record<string, HealthChecker> => ({
        database: createDatabaseHealthChecker(dataSource as DataSource),
        redis: createRedisHealthChecker(redisClient as ForgeRedisClient),
      }),
      inject: [DATABASE_DATA_SOURCE, REDIS_CLIENT],
    }),
    AuctionModule,
  ],
})
export class AppModule {}
