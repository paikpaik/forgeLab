import "reflect-metadata";
import { NestFactory, HttpAdapterHost } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ForgeExceptionFilter } from "@paikpaik/node-forge/response/nestjs";
import { ForgeLoggerService } from "@paikpaik/node-forge/logger/nestjs";
import { METRICS_INSTANCE } from "@paikpaik/node-forge/metrics/nestjs";
import type { ForgeMetrics } from "@paikpaik/node-forge/metrics";
import { registerMetricsInto } from "@paikpaik/kafka-forge";
import { FulfillmentAppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(FulfillmentAppModule, { bufferLogs: true });

  // panel.html은 api(3200)가 서빙하지만, /admin/logs/stream(confirmed 이벤트)은 fulfillment
  // 자신의 포트(3201)에서만 나온다 — live-ranking의 ingest/aggregator와 같은 이유로 CORS가
  // 필요하다(브라우저 입장에서 cross-origin 요청).
  app.enableCors();

  registerMetricsInto(app.get<ForgeMetrics>(METRICS_INSTANCE).registry);

  app.useLogger(app.get(ForgeLoggerService));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ForgeExceptionFilter(app.get(HttpAdapterHost)));

  const port = Number(process.env.PORT ?? 3201);
  await app.listen(port);
}

void bootstrap();
