import { Module } from "@nestjs/common";
import type { MiddlewareConsumer, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { LoggerModule, TraceAccessLogMiddleware } from "@paikpaik/node-forge/logger/nestjs";
import type { LoggerOptions } from "@paikpaik/node-forge/logger";
import { MetricsModule } from "@paikpaik/node-forge/metrics/nestjs";
import { HealthModule } from "@paikpaik/node-forge/health/nestjs";
import { IpBlockMiddleware } from "./middleware/ip-block.middleware";
import { GatewayModule } from "./gateway.module";

const logLevel = (process.env.LOG_LEVEL ?? "info") as NonNullable<LoggerOptions["level"]>;

@Module({
  imports: [
    LoggerModule.forRoot({ level: logLevel }),
    MetricsModule.forRoot({}),
    // gateway 자신은 DB/브로커 같은 외부 상태가 없다 — "프로세스가 떠 있는지"만 의미가
    // 있어서 체커 없이 등록한다. 각 도메인 서비스의 실제 상태는 자기 자신의 /health로 확인.
    HealthModule.forRoot({ checkers: {} }),
    // IP당 60초에 20회로 제한 — 이 실험의 데모 기준치, 실서비스라면 라우트별로 다르게 줘야 함
    // (체크아웃은 빡빡하게, 조회는 느슨하게 등).
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.RATE_LIMIT_TTL_MS ?? 60_000),
        limit: Number(process.env.RATE_LIMIT_LIMIT ?? 20),
      },
    ]),
    GatewayModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class GatewayAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // IP 차단이 가장 먼저 — 차단된 IP는 access log조차 남길 필요 없이 즉시 거부.
    consumer.apply(IpBlockMiddleware, TraceAccessLogMiddleware).forRoutes("*");
  }
}
