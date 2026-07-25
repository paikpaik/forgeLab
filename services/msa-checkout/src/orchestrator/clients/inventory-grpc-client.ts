import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { ClientGrpc } from "@nestjs/microservices";
import { firstValueFrom, Observable } from "rxjs";
import { InventoryActionResult, InventoryClient, TryReserveResult } from "./inventory-client";

interface InventoryServiceGrpc {
  tryReserve(req: {
    sagaId: string;
    productId: string;
    quantity: number;
  }): Observable<{ success: boolean; reservationId: string; error: string }>;
  confirmReserve(req: { sagaId: string; reservationId: string }): Observable<{ success: boolean; error: string }>;
  cancelReserve(req: { sagaId: string; reservationId: string }): Observable<{ success: boolean; error: string }>;
}

export const INVENTORY_GRPC_PACKAGE = Symbol("INVENTORY_GRPC_PACKAGE");

@Injectable()
export class InventoryGrpcClient implements InventoryClient, OnModuleInit {
  private grpcService!: InventoryServiceGrpc;

  constructor(@Inject(INVENTORY_GRPC_PACKAGE) private readonly client: ClientGrpc) {}

  onModuleInit(): void {
    this.grpcService = this.client.getService<InventoryServiceGrpc>("InventoryService");
  }

  async tryReserve(sagaId: string, productId: string, quantity: number): Promise<TryReserveResult> {
    const res = await firstValueFrom(this.grpcService.tryReserve({ sagaId, productId, quantity }));
    return { success: res.success, reservationId: res.reservationId || undefined, error: res.error || undefined };
  }

  async confirmReserve(sagaId: string, reservationId: string): Promise<InventoryActionResult> {
    const res = await firstValueFrom(this.grpcService.confirmReserve({ sagaId, reservationId }));
    return { success: res.success, error: res.error || undefined };
  }

  async cancelReserve(sagaId: string, reservationId: string): Promise<InventoryActionResult> {
    const res = await firstValueFrom(this.grpcService.cancelReserve({ sagaId, reservationId }));
    return { success: res.success, error: res.error || undefined };
  }
}
