import "reflect-metadata";
import { join } from "node:path";
import { NestFactory, HttpAdapterHost } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ValidationPipe } from "@nestjs/common";
import { ForgeExceptionFilter } from "@paikpaik/node-forge/response/nestjs";
import { ForgeLoggerService } from "@paikpaik/node-forge/logger/nestjs";
import { GatewayAppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(GatewayAppModule, { bufferLogs: true });

  // 이 실험의 유일한 REST 진입점 — panel.html도 gateway가 서빙한다.
  app.useStaticAssets(join(__dirname, "..", "..", "public"));

  app.useLogger(app.get(ForgeLoggerService));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ForgeExceptionFilter(app.get(HttpAdapterHost)));

  const port = Number(process.env.PORT ?? 3300);
  await app.listen(port);
}

void bootstrap();
