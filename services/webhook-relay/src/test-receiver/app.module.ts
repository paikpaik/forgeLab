import { Module } from "@nestjs/common";
import { LoggerModule } from "@paikpaik/node-forge/logger/nestjs";
import type { LoggerOptions } from "@paikpaik/node-forge/logger";
import { MetricsModule } from "@paikpaik/node-forge/metrics/nestjs";
import { HealthModule } from "@paikpaik/node-forge/health/nestjs";
import { ReceiverController } from "./receiver.controller";

const logLevel = (process.env.LOG_LEVEL ?? "info") as NonNullable<LoggerOptions["level"]>;

@Module({
  imports: [LoggerModule.forRoot({ level: logLevel }), MetricsModule.forRoot({}), HealthModule.forRoot({ checkers: {} })],
  controllers: [ReceiverController],
})
export class TestReceiverAppModule {}
