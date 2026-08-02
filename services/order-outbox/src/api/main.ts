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
import { ApiAppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(ApiAppModule, { bufferLogs: true });

  // public/panel.html — dashboard가 forge-lab.json의 panelUrl로 iframe에 그대로 띄운다.
  // 주문 생성/조회 API가 다 이 프로세스에 있어서, live-ranking과 달리 CORS 설정이 필요 없다.
  app.useStaticAssets(join(__dirname, "..", "..", "public"));
  // 4개 실험 패널 공유 CSS/JS — require.resolve로 실제 위치를 찾는다(waiting-room과 동일 패턴).
  const panelUiDist = join(require.resolve("@forge-lab/panel-ui/package.json"), "..", "dist");
  app.useStaticAssets(panelUiDist, { prefix: "/shared/" });

  registerMetricsInto(app.get<ForgeMetrics>(METRICS_INSTANCE).registry);

  app.useLogger(app.get(ForgeLoggerService));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ForgeExceptionFilter(app.get(HttpAdapterHost)));

  const port = Number(process.env.PORT ?? 3200);
  await app.listen(port);
}

void bootstrap();
