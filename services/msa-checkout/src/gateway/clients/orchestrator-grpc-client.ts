import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { ClientGrpc } from "@nestjs/microservices";
import { firstValueFrom, Observable } from "rxjs";

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
  startCheckout(req: {
    userId: string;
    productId: string;
    quantity: number;
  }): Observable<{ sagaId: string }>;
  getSagaStatus(req: { sagaId: string }): Observable<SagaStatusGrpc>;
}

@Injectable()
export class OrchestratorGrpcClient implements OnModuleInit {
  private grpcService!: CheckoutSagaServiceGrpc;

  constructor(@Inject(ORCHESTRATOR_GRPC_PACKAGE) private readonly client: ClientGrpc) {}

  onModuleInit(): void {
    this.grpcService = this.client.getService<CheckoutSagaServiceGrpc>("CheckoutSagaService");
  }

  async startCheckout(userId: string, productId: string, quantity: number): Promise<{ sagaId: string }> {
    return firstValueFrom(this.grpcService.startCheckout({ userId, productId, quantity }));
  }

  async getSagaStatus(sagaId: string): Promise<SagaStatusGrpc> {
    return firstValueFrom(this.grpcService.getSagaStatus({ sagaId }));
  }
}
