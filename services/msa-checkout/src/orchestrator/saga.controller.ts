import { Controller, UseInterceptors } from "@nestjs/common";
import { GrpcMethod } from "@nestjs/microservices";
import { GrpcTraceAccessLogInterceptor } from "@paikpaik/node-forge/grpc/nestjs";
import { SagaService } from "./saga.service";
import { TraceRecorderService, withSpan } from "../shared/trace-recorder";

interface StartCheckoutRequest {
  userId: string;
  productId: string;
  quantity: number;
}

interface GetSagaStatusRequest {
  sagaId: string;
}

@Controller()
@UseInterceptors(GrpcTraceAccessLogInterceptor)
export class SagaController {
  constructor(
    private readonly sagaService: SagaService,
    private readonly traceRecorder: TraceRecorderService,
  ) {}

  @GrpcMethod("CheckoutSagaService", "StartCheckout")
  async startCheckout(request: StartCheckoutRequest) {
    return withSpan(this.traceRecorder, "orchestrator", "StartCheckout", async () => {
      const sagaId = await this.sagaService.startCheckout(request.userId, request.productId, request.quantity);
      return { sagaId };
    });
  }

  @GrpcMethod("CheckoutSagaService", "GetSagaStatus")
  async getSagaStatus(request: GetSagaStatusRequest) {
    const view = await this.sagaService.getStatus(request.sagaId);
    if (!view) return { found: false };
    return {
      found: true,
      sagaId: view.sagaId,
      status: view.status,
      productId: view.productId,
      quantity: view.quantity,
      orderId: view.orderId ?? "",
      reservationId: view.reservationId ?? "",
      lastError: view.lastError ?? "",
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
      traceId: view.traceId ?? "",
    };
  }
}
