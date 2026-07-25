import { Module } from "@nestjs/common";
import { ClientsModule } from "@nestjs/microservices";
import { JwtModule } from "@nestjs/jwt";
import { grpcClientOptions } from "../shared/grpc-client.util";
import { AUTH_TOKEN_SECRET, AUTH_TOKEN_TTL } from "../shared/constants";
import { AuthTokenService } from "../shared/auth/auth-token.service";
import { AuthGuard } from "../shared/auth/auth.guard";
import { RolesGuard } from "../shared/auth/roles.guard";
import { AuthController } from "./auth.controller";
import { CheckoutController } from "./checkout.controller";
import { AdminController } from "./admin.controller";
import { ORCHESTRATOR_GRPC_PACKAGE, OrchestratorGrpcClient } from "./clients/orchestrator-grpc-client";
import { INVENTORY_ADMIN_GRPC_PACKAGE, InventoryAdminGrpcClient } from "./clients/inventory-admin-grpc-client";

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? "localhost:50051";
const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL ?? "localhost:50053";

@Module({
  imports: [
    JwtModule.register({
      secret: AUTH_TOKEN_SECRET,
      signOptions: { expiresIn: AUTH_TOKEN_TTL },
    }),
    ClientsModule.register([
      { name: ORCHESTRATOR_GRPC_PACKAGE, ...grpcClientOptions("checkout", "checkout.proto", ORCHESTRATOR_URL) },
      {
        name: INVENTORY_ADMIN_GRPC_PACKAGE,
        ...grpcClientOptions("inventory", "inventory.proto", INVENTORY_SERVICE_URL),
      },
    ]),
  ],
  controllers: [AuthController, CheckoutController, AdminController],
  providers: [AuthTokenService, AuthGuard, RolesGuard, OrchestratorGrpcClient, InventoryAdminGrpcClient],
})
export class GatewayModule {}
