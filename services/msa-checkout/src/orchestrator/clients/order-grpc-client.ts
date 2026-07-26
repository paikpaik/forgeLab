import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { ClientGrpc } from "@nestjs/microservices";
import type { Metadata } from "@grpc/grpc-js";
import { firstValueFrom, Observable } from "rxjs";
import { buildOutgoingTraceMetadata } from "@paikpaik/node-forge/grpc/nestjs";
import { OrderActionResult, OrderClient, TryCreateOrderResult } from "./order-client";

interface OrderServiceGrpc {
  tryCreateOrder(
    req: { sagaId: string; userId: string; productId: string; quantity: number },
    metadata: Metadata,
  ): Observable<{ success: boolean; orderId: string; error: string }>;
  confirmOrder(
    req: { sagaId: string; orderId: string },
    metadata: Metadata,
  ): Observable<{ success: boolean; error: string }>;
  cancelOrder(
    req: { sagaId: string; orderId: string },
    metadata: Metadata,
  ): Observable<{ success: boolean; error: string }>;
}

export const ORDER_GRPC_PACKAGE = Symbol("ORDER_GRPC_PACKAGE");

@Injectable()
export class OrderGrpcClient implements OrderClient, OnModuleInit {
  private grpcService!: OrderServiceGrpc;

  constructor(@Inject(ORDER_GRPC_PACKAGE) private readonly client: ClientGrpc) {}

  onModuleInit(): void {
    this.grpcService = this.client.getService<OrderServiceGrpc>("OrderService");
  }

  async tryCreateOrder(
    sagaId: string,
    userId: string,
    productId: string,
    quantity: number,
  ): Promise<TryCreateOrderResult> {
    const res = await firstValueFrom(
      this.grpcService.tryCreateOrder({ sagaId, userId, productId, quantity }, buildOutgoingTraceMetadata()),
    );
    return { success: res.success, orderId: res.orderId || undefined, error: res.error || undefined };
  }

  async confirmOrder(sagaId: string, orderId: string): Promise<OrderActionResult> {
    const res = await firstValueFrom(this.grpcService.confirmOrder({ sagaId, orderId }, buildOutgoingTraceMetadata()));
    return { success: res.success, error: res.error || undefined };
  }

  async cancelOrder(sagaId: string, orderId: string): Promise<OrderActionResult> {
    const res = await firstValueFrom(this.grpcService.cancelOrder({ sagaId, orderId }, buildOutgoingTraceMetadata()));
    return { success: res.success, error: res.error || undefined };
  }
}
