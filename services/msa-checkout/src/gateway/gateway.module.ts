import { join } from "node:path";
import { Module } from "@nestjs/common";
import { ClientsModule } from "@nestjs/microservices";
import { createGrpcClientOptions } from "@paikpaik/node-forge/grpc/nestjs";
import { JwtAuthModule, JwtAuthGuard, RolesGuard } from "@paikpaik/node-forge/auth/nestjs";
import { AUTH_TOKEN_SECRET, AUTH_TOKEN_TTL } from "../shared/constants";
import { AuthController } from "./auth.controller";
import { CheckoutController } from "./checkout.controller";
import { AdminController } from "./admin.controller";
import { ORCHESTRATOR_GRPC_PACKAGE, OrchestratorGrpcClient } from "./clients/orchestrator-grpc-client";
import { INVENTORY_ADMIN_GRPC_PACKAGE, InventoryAdminGrpcClient } from "./clients/inventory-admin-grpc-client";

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? "localhost:50051";
const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL ?? "localhost:50053";

@Module({
  imports: [
    JwtAuthModule.forRoot({ secret: AUTH_TOKEN_SECRET, expiresIn: AUTH_TOKEN_TTL }),
    ClientsModule.register([
      {
        name: ORCHESTRATOR_GRPC_PACKAGE,
        ...createGrpcClientOptions({
          packageName: "checkout",
          protoPath: join(__dirname, "..", "..", "proto", "checkout.proto"),
          target: ORCHESTRATOR_URL,
        }),
      },
      {
        name: INVENTORY_ADMIN_GRPC_PACKAGE,
        ...createGrpcClientOptions({
          packageName: "inventory",
          protoPath: join(__dirname, "..", "..", "proto", "inventory.proto"),
          target: INVENTORY_SERVICE_URL,
        }),
      },
    ]),
  ],
  controllers: [AuthController, CheckoutController, AdminController],
  providers: [JwtAuthGuard, RolesGuard, OrchestratorGrpcClient, InventoryAdminGrpcClient],
})
export class GatewayModule {}
