import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { ClientGrpc } from "@nestjs/microservices";
import type { Metadata } from "@grpc/grpc-js";
import { firstValueFrom, Observable } from "rxjs";
import { buildOutgoingTraceMetadata } from "@paikpaik/node-forge/grpc/nestjs";

export const ORCHESTRATOR_GRPC_PACKAGE = Symbol("ORCHESTRATOR_GRPC_PACKAGE");

export interface SagaStatusGrpc {
  found: boolean;
  sagaId: string;
  status: string;
  productId: string;
  quantity: number;
  orderId: string;
  reservationId: string;
  lastError: string;
  createdAt: string;
  updatedAt: string;
}

interface CheckoutSagaServiceGrpc {
  startCheckout(
    req: { userId: string; productId: string; quantity: number },
    metadata: Metadata,
  ): Observable<{ sagaId: string }>;
  getSagaStatus(req: { sagaId: string }, metadata: Metadata): Observable<SagaStatusGrpc>;
}

@Injectable()
export class OrchestratorGrpcClient implements OnModuleInit {
  private grpcService!: CheckoutSagaServiceGrpc;

  constructor(@Inject(ORCHESTRATOR_GRPC_PACKAGE) private readonly client: ClientGrpc) {}

  onModuleInit(): void {
    this.grpcService = this.client.getService<CheckoutSagaServiceGrpc>("CheckoutSagaService");
  }

  async startCheckout(userId: string, productId: string, quantity: number): Promise<{ sagaId: string }> {
    return firstValueFrom(this.grpcService.startCheckout({ userId, productId, quantity }, buildOutgoingTraceMetadata()));
  }

  async getSagaStatus(sagaId: string): Promise<SagaStatusGrpc> {
    return firstValueFrom(this.grpcService.getSagaStatus({ sagaId }, buildOutgoingTraceMetadata()));
  }
}
