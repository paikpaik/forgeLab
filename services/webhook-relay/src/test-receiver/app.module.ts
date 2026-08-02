import { Module } from "@nestjs/common";
import { LoggerModule } from "@paikpaik/node-forge/logger/nestjs";
import type { LoggerOptions } from "@paikpaik/node-forge/logger";
import { MetricsModule } from "@paikpaik/node-forge/metrics/nestjs";
import { HealthModule } from "@paikpaik/node-forge/health/nestjs";
import { AdminEventsModule } from "@paikpaik/node-forge/events/nestjs";
import { ReceiverController } from "./receiver.controller";

const logLevel = (process.env.LOG_LEVEL ?? "info") as NonNullable<LoggerOptions["level"]>;

@Module({
  imports: [
    LoggerModule.forRoot({ level: logLevel }),
    MetricsModule.forRoot({}),
    HealthModule.forRoot({ checkers: {} }),
    // public/channel.html이 구독하는 SSE(`/channel/stream`) — 웹훅이 실제로 도착했을 때
    // "받았다"는 게 눈에 보이는 효과로 이어지는 걸 보여주기 위한 실사용 데모 채널.
    AdminEventsModule.forRoot({ path: "channel" }),
  ],
  controllers: [ReceiverController],
})
export class TestReceiverAppModule {}
