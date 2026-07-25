import { Module } from "@nestjs/common";
import { LoggerModule } from "@paikpaik/node-forge/logger/nestjs";
import type { LoggerOptions } from "@paikpaik/node-forge/logger";
import { MetricsModule } from "@paikpaik/node-forge/metrics/nestjs";
import { HealthModule } from "@paikpaik/node-forge/health/nestjs";
import { GatewayModule } from "./gateway.module";

const logLevel = (process.env.LOG_LEVEL ?? "info") as NonNullable<LoggerOptions["level"]>;

@Module({
  imports: [
    LoggerModule.forRoot({ level: logLevel }),
    MetricsModule.forRoot({}),
    // gateway 자신은 DB/브로커 같은 외부 상태가 없다 — "프로세스가 떠 있는지"만 의미가
    // 있어서 체커 없이 등록한다. 각 도메인 서비스의 실제 상태는 자기 자신의 /health로 확인.
    HealthModule.forRoot({ checkers: {} }),
    GatewayModule,
  ],
})
export class GatewayAppModule {}
