import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { ClientGrpc } from "@nestjs/microservices";
import type { Metadata } from "@grpc/grpc-js";
import { firstValueFrom, Observable } from "rxjs";
import { buildOutgoingTraceMetadata } from "@paikpaik/node-forge/grpc/nestjs";

export const INVENTORY_ADMIN_GRPC_PACKAGE = Symbol("INVENTORY_ADMIN_GRPC_PACKAGE");

// saga 흐름과 무관하게 gateway가 inventory-service를 직접 호출하는 admin 전용 경로 —
// orchestrator를 거치지 않는다(재고 리셋은 트랜잭션이 아니라 테스트/데모용 관리 작업).
interface InventoryServiceGrpc {
  resetStock(
    req: { productId: string; total: number },
    metadata: Metadata,
  ): Observable<{ success: boolean; error: string }>;
  getStock(
    req: { productId: string },
    metadata: Metadata,
  ): Observable<{ found: boolean; productId: string; total: number; reserved: number; available: number }>;
}

@Injectable()
export class InventoryAdminGrpcClient implements OnModuleInit {
  private grpcService!: InventoryServiceGrpc;

  constructor(@Inject(INVENTORY_ADMIN_GRPC_PACKAGE) private readonly client: ClientGrpc) {}

  onModuleInit(): void {
    this.grpcService = this.client.getService<InventoryServiceGrpc>("InventoryService");
  }

  async resetStock(productId: string, total: number) {
    return firstValueFrom(this.grpcService.resetStock({ productId, total }, buildOutgoingTraceMetadata()));
  }

  async getStock(productId: string) {
    return firstValueFrom(this.grpcService.getStock({ productId }, buildOutgoingTraceMetadata()));
  }
}
