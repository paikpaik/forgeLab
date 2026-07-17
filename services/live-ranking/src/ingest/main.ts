import "reflect-metadata";
import { NestFactory, HttpAdapterHost } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ForgeExceptionFilter } from "@paikpaik/node-forge/response/nestjs";
import { ForgeLoggerService } from "@paikpaik/node-forge/logger/nestjs";
import { METRICS_INSTANCE } from "@paikpaik/node-forge/metrics/nestjs";
import type { ForgeMetrics } from "@paikpaik/node-forge/metrics";
import { registerMetricsInto } from "@paikpaik/kafka-forge";
import { IngestAppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(IngestAppModule, { bufferLogs: true });

  // panel.html은 aggregator(port 3101)가 서빙하지만 이벤트 발행은 ingest(port 3100)로 직접
  // POST한다 — 브라우저 기준 cross-origin이라 CORS를 열어야 한다.
  app.enableCors();

  // kafka-forge 1.0.2부터 자기 지표(kafka_forge_*)를 외부 Registry에도 등록해주는
  // registerMetricsInto가 생겨서, 더 이상 /metrics/kafka로 따로 노출할 필요가 없다 —
  // node-forge의 GET /metrics 하나에 합쳐진다 (proposals/kafka-forge/20260717 반영).
  registerMetricsInto(app.get<ForgeMetrics>(METRICS_INSTANCE).registry);

  app.useLogger(app.get(ForgeLoggerService));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ForgeExceptionFilter(app.get(HttpAdapterHost)));

  const port = Number(process.env.PORT ?? 3100);
  await app.listen(port);
}

void bootstrap();
