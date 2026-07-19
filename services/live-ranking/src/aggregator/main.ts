import "reflect-metadata";
import { join } from "node:path";
import { NestFactory, HttpAdapterHost } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ValidationPipe } from "@nestjs/common";
import { ForgeExceptionFilter } from "@paikpaik/node-forge/response/nestjs";
import { ForgeLoggerService } from "@paikpaik/node-forge/logger/nestjs";
import { METRICS_INSTANCE } from "@paikpaik/node-forge/metrics/nestjs";
import type { ForgeMetrics } from "@paikpaik/node-forge/metrics";
import { registerMetricsInto } from "@paikpaik/kafka-forge";
import { AggregatorAppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AggregatorAppModule, { bufferLogs: true });

  // public/panel.html — dashboard가 forge-lab.json의 panelUrl로 iframe에 그대로 띄운다.
  // main.ts가 dist/aggregator/main.js로 컴파일되므로(waiting-room처럼 dist/main.js가 아니라
  // 한 단계 더 들어가 있음) public까지 두 단계 위로 올라가야 한다.
  app.useStaticAssets(join(__dirname, "..", "..", "public"));

  // kafka-forge 1.0.2부터 자기 지표(kafka_forge_*, dedupedTotal 포함)를 외부 Registry에도
  // 등록해주는 registerMetricsInto가 생겨서, /metrics/kafka로 따로 노출하던 것과 직접 만든
  // scoreEventsDeduped 카운터를 걷어내고 node-forge의 GET /metrics 하나로 합친다
  // (proposals/kafka-forge/20260717 반영).
  registerMetricsInto(app.get<ForgeMetrics>(METRICS_INSTANCE).registry);

  app.useLogger(app.get(ForgeLoggerService));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ForgeExceptionFilter(app.get(HttpAdapterHost)));

  const port = Number(process.env.PORT ?? 3101);
  await app.listen(port);
}

void bootstrap();
