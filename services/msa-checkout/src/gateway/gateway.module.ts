import { join } from "node:path";
import { Module } from "@nestjs/common";
import { ClientsModule } from "@nestjs/microservices";
import { createGrpcClientOptions } from "@paikpaik/node-forge/grpc/nestjs";
import { JwtAuthModule, JwtAuthGuard, RolesGuard } from "@paikpaik/node-forge/auth/nestjs";
import { AdminEventsModule } from "@paikpaik/node-forge/events/nestjs";
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
    // panel.html의 개발자 콘솔 "로그" 탭이 구독하는 SSE(/admin/logs/stream) — 다른 4개
    // 서비스와 동일한 node-forge 1.0.9 패턴. CheckoutController/AdminController가 바로 이
    // 모듈 소속이라 여기서 등록해야 DI가 닿는다(GatewayAppModule 루트에 두면 형제 모듈이라
    // 안 닿음 — 처음에 거기 뒀다가 부팅 실패로 확인).
    AdminEventsModule.forRoot({ path: "admin/logs" }),
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
