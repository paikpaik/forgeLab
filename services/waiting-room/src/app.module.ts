import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { RedisModule, REDIS_CLIENT } from "@paikpaik/node-forge/redis/nestjs";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import { LoggerModule } from "@paikpaik/node-forge/logger/nestjs";
import type { LoggerOptions } from "@paikpaik/node-forge/logger";
import { MetricsModule } from "@paikpaik/node-forge/metrics/nestjs";
import { HealthModule } from "@paikpaik/node-forge/health/nestjs";
import { createRedisHealthChecker } from "@paikpaik/node-forge/health";
import { WaitingRoomModule } from "./waiting-room/waiting-room.module";

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
    ScheduleModule.forRoot(),
    HealthModule.forRootAsync({
      useFactory: (redisClient: unknown) => ({
        redis: createRedisHealthChecker(redisClient as ForgeRedisClient),
      }),
      inject: [REDIS_CLIENT],
    }),
    WaitingRoomModule,
  ],
})
export class AppModule {}
