import "reflect-metadata";
import { NestFactory, HttpAdapterHost } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { MicroserviceOptions } from "@nestjs/microservices";
import { ForgeExceptionFilter } from "@paikpaik/node-forge/response/nestjs";
import { ForgeLoggerService } from "@paikpaik/node-forge/logger/nestjs";
import { grpcServerOptions } from "../shared/grpc-client.util";
import { InventoryAppModule } from "./app.module";

// gRPC 서버 하나만 있으면 /health, /metrics를 못 붙이므로(node-forge는 HTTP 기반) NestJS의
// hybrid application으로 REST(health/metrics)와 gRPC 마이크로서비스를 같은 프로세스에 둔다.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(InventoryAppModule, { bufferLogs: true });

  app.connectMicroservice<MicroserviceOptions>(
    grpcServerOptions("inventory", "inventory.proto", `0.0.0.0:${process.env.GRPC_PORT ?? 50053}`),
  );

  app.useLogger(app.get(ForgeLoggerService));
  app.useGlobalFilters(new ForgeExceptionFilter(app.get(HttpAdapterHost)));

  await app.startAllMicroservices();
  const port = Number(process.env.PORT ?? 3303);
  await app.listen(port);
}

void bootstrap();
