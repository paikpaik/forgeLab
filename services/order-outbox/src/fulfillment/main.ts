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

  registerMetricsInto(app.get<ForgeMetrics>(METRICS_INSTANCE).registry);

  app.useLogger(app.get(ForgeLoggerService));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ForgeExceptionFilter(app.get(HttpAdapterHost)));

  const port = Number(process.env.PORT ?? 3201);
  await app.listen(port);
}

void bootstrap();
