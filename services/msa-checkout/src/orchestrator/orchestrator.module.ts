import { join } from "node:path";
import { Module } from "@nestjs/common";
import { ClientsModule } from "@nestjs/microservices";
import { createGrpcClientOptions } from "@paikpaik/node-forge/grpc/nestjs";
import { SagaController } from "./saga.controller";
import { SagaService } from "./saga.service";
import { SagaProcessorService } from "./saga-processor.service";
import { ORDER_CLIENT } from "./clients/order-client";
import { ORDER_GRPC_PACKAGE, OrderGrpcClient } from "./clients/order-grpc-client";
import { INVENTORY_CLIENT } from "./clients/inventory-client";
import { INVENTORY_GRPC_PACKAGE, InventoryGrpcClient } from "./clients/inventory-grpc-client";

const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL ?? "localhost:50052";
const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL ?? "localhost:50053";

@Module({
  imports: [
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
    OrderGrpcClient,
    InventoryGrpcClient,
    { provide: ORDER_CLIENT, useExisting: OrderGrpcClient },
    { provide: INVENTORY_CLIENT, useExisting: InventoryGrpcClient },
  ],
})
export class OrchestratorModule {}
