import "reflect-metadata";
import { join } from "node:path";
import { NestFactory, HttpAdapterHost } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ValidationPipe } from "@nestjs/common";
import { ForgeExceptionFilter } from "@paikpaik/node-forge/response/nestjs";
import { ForgeLoggerService } from "@paikpaik/node-forge/logger/nestjs";
import { IngestAppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(IngestAppModule, { bufferLogs: true });

  // public/panel.html — dashboard가 forge-lab.json의 panelUrl로 iframe에 그대로 띄운다.
  // main.ts가 dist/ingest/main.js로 컴파일되므로(order-outbox의 api/fulfillment와 동일하게
  // 프로세스별 하위 폴더가 한 단계 더 있음) public까지 두 단계 위로 올라가야 한다.
  app.useStaticAssets(join(__dirname, "..", "..", "public"));
  // 4개 실험 패널 공유 CSS/JS — require.resolve로 실제 위치를 찾는다(다른 실험과 동일 패턴).
  const panelUiDist = join(require.resolve("@forge-lab/panel-ui/package.json"), "..", "dist");
  app.useStaticAssets(panelUiDist, { prefix: "/shared/" });

  app.useLogger(app.get(ForgeLoggerService));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ForgeExceptionFilter(app.get(HttpAdapterHost)));

  const port = Number(process.env.PORT ?? 3400);
  await app.listen(port);
}

void bootstrap();
