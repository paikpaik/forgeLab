import { join } from "node:path";
import { Module } from "@nestjs/common";
import { ClientsModule } from "@nestjs/microservices";
import { createGrpcClientOptions } from "@paikpaik/node-forge/grpc/nestjs";
import { RedisModule } from "@paikpaik/node-forge/redis/nestjs";
import { SagaController } from "./saga.controller";
import { SagaService } from "./saga.service";
import { SagaProcessorService } from "./saga-processor.service";
import { ORDER_CLIENT } from "./clients/order-client";
import { ORDER_GRPC_PACKAGE, OrderGrpcClient } from "./clients/order-grpc-client";
import { INVENTORY_CLIENT } from "./clients/inventory-client";
import { INVENTORY_GRPC_PACKAGE, InventoryGrpcClient } from "./clients/inventory-grpc-client";
import { TraceRecorderService } from "../shared/trace-recorder";

const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL ?? "localhost:50052";
const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL ?? "localhost:50053";
const redisOptions = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

@Module({
  imports: [
    // TraceRecorderService(트레이스 스팬 기록)를 주입받는 SagaController/SagaService가
    // 이 모듈 소속이라 여기서 등록해야 DI가 닿는다(gateway에서 AdminEventsModule을 루트
    // 앱모듈에 뒀다가 형제 모듈이라 못 찾은 적이 있어 — 같은 실수 재발 방지).
    RedisModule.forRoot(redisOptions),
    ClientsModule.register([
      {
        name: ORDER_GRPC_PACKAGE,
        ...createGrpcClientOptions({
          packageName: "order",
          protoPath: join(__dirname, "..", "..", "proto", "order.proto"),
          target: ORDER_SERVICE_URL,
        }),
      },
      {
        name: INVENTORY_GRPC_PACKAGE,
        ...createGrpcClientOptions({
          packageName: "inventory",
          protoPath: join(__dirname, "..", "..", "proto", "inventory.proto"),
          target: INVENTORY_SERVICE_URL,
        }),
      },
    ]),
  ],
  controllers: [SagaController],
  providers: [
    SagaService,
    SagaProcessorService,
    TraceRecorderService,
    OrderGrpcClient,
    InventoryGrpcClient,
    { provide: ORDER_CLIENT, useExisting: OrderGrpcClient },
    { provide: INVENTORY_CLIENT, useExisting: InventoryGrpcClient },
  ],
})
export class OrchestratorModule {}
