import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { RedisModule, REDIS_CLIENT } from "@paikpaik/node-forge/redis/nestjs";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import { DistributedCircuitBreaker } from "@paikpaik/node-forge/redis";
import { ForgeHttpClient } from "@paikpaik/node-forge/http";
import { AdminEventsModule } from "@paikpaik/node-forge/events/nestjs";
import { PaymentController } from "./payment.controller";
import { AdminController } from "./admin.controller";
import { PgWebhookController } from "./pg-webhook.controller";
import { PaymentService } from "./payment.service";
import { PaymentReconcilerService } from "./payment-reconciler.service";
import { PG_HTTP_CLIENT } from "./app.constants";
import { CIRCUIT_FAILURE_THRESHOLD, CIRCUIT_RESET_TIMEOUT_MS, FAKE_PG_TIMEOUT_MS } from "../shared/constants";

const redisOptions = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

@Module({
  imports: [
    ScheduleModule.forRoot(),
    // RedisModule/AdminEventsModule은 이 모듈이 실제로 컨트롤러/서비스를 갖고 있는 feature
    // 모듈이라 여기서 등록한다(live-auction에서부터 지켜온 DI 배선 원칙).
    RedisModule.forRoot(redisOptions),
    AdminEventsModule.forRoot({ path: "admin/logs" }),
  ],
  controllers: [PaymentController, AdminController, PgWebhookController],
  providers: [
    PaymentService,
    PaymentReconcilerService,
    {
      // DistributedCircuitBreaker의 생성자가 (redis, options) plain constructor라 NestJS가
      // 자동 조립을 못 한다 — webhook-relay와 동일한 이유로 useFactory 등록.
      provide: DistributedCircuitBreaker,
      useFactory: (redis: ForgeRedisClient) =>
        new DistributedCircuitBreaker(redis, {
          failureThreshold: CIRCUIT_FAILURE_THRESHOLD,
          resetTimeout: CIRCUIT_RESET_TIMEOUT_MS,
        }),
      inject: [REDIS_CLIENT],
    },
    {
      // fake-pg 호출 전용 ForgeHttpClient — retries는 fake-pg가 clientReference로 멱등
      // 처리하기 때문에 안전하다(중복 과금 걱정 없이 재시도 가능).
      provide: PG_HTTP_CLIENT,
      useFactory: () =>
        new ForgeHttpClient({
          baseURL: process.env.FAKE_PG_URL ?? "http://localhost:3601",
          timeout: FAKE_PG_TIMEOUT_MS,
          retries: 2,
          retryDelay: 300,
        }),
    },
  ],
})
export class PaymentModule {}
