import "reflect-metadata";
import { NestFactory, HttpAdapterHost } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { MicroserviceOptions } from "@nestjs/microservices";
import { ForgeExceptionFilter } from "@paikpaik/node-forge/response/nestjs";
import { ForgeLoggerService } from "@paikpaik/node-forge/logger/nestjs";
import { grpcServerOptions } from "../shared/grpc-client.util";
import { OrderAppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(OrderAppModule, { bufferLogs: true });

  app.connectMicroservice<MicroserviceOptions>(
    grpcServerOptions("order", "order.proto", `0.0.0.0:${process.env.GRPC_PORT ?? 50052}`),
  );

  app.useLogger(app.get(ForgeLoggerService));
  app.useGlobalFilters(new ForgeExceptionFilter(app.get(HttpAdapterHost)));

  await app.startAllMicroservices();
  const port = Number(process.env.PORT ?? 3302);
  await app.listen(port);
}

void bootstrap();
