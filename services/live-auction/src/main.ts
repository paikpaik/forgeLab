import "reflect-metadata";
import { join } from "node:path";
import { NestFactory, HttpAdapterHost } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ValidationPipe } from "@nestjs/common";
import { ForgeExceptionFilter } from "@paikpaik/node-forge/response/nestjs";
import { ForgeLoggerService } from "@paikpaik/node-forge/logger/nestjs";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.enableCors({ origin: "*" });

  // public/panel.html — dashboard가 forge-lab.json의 panelUrl로 iframe에 그대로 띄운다.
  // main.ts가 dist/main.js로 컴파일되므로(단일 프로세스, waiting-room과 동일 구조) public은
  // 한 단계만 위로 올라가면 된다.
  app.useStaticAssets(join(__dirname, "..", "public"));
  const panelUiDist = join(require.resolve("@forge-lab/panel-ui/package.json"), "..", "dist");
  app.useStaticAssets(panelUiDist, { prefix: "/shared/" });

  app.useLogger(app.get(ForgeLoggerService));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ForgeExceptionFilter(app.get(HttpAdapterHost)));

  const port = Number(process.env.PORT ?? 3500);
  await app.listen(port);
}

void bootstrap();
