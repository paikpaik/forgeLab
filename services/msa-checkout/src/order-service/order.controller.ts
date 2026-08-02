import { Controller, UseInterceptors } from "@nestjs/common";
import { GrpcMethod } from "@nestjs/microservices";
import { GrpcTraceAccessLogInterceptor } from "@paikpaik/node-forge/grpc/nestjs";
import { OrderService } from "./order.service";
import { TraceRecorderService, withSpan } from "../shared/trace-recorder";

interface TryCreateOrderRequest {
  sagaId: string;
  userId: string;
  productId: string;
  quantity: number;
}

interface OrderRequest {
  sagaId: string;
  orderId: string;
}

@Controller()
@UseInterceptors(GrpcTraceAccessLogInterceptor)
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly traceRecorder: TraceRecorderService,
  ) {}

  @GrpcMethod("OrderService", "TryCreateOrder")
  async tryCreateOrder(request: TryCreateOrderRequest) {
    return withSpan(this.traceRecorder, "order-service", "TryCreateOrder", async () => {
      const result = await this.orderService.tryCreateOrder(
        request.sagaId,
        request.userId,
        request.productId,
        request.quantity,
      );
      return { success: result.success, orderId: result.orderId ?? "", error: result.error ?? "" };
    });
  }

  @GrpcMethod("OrderService", "ConfirmOrder")
  async confirmOrder(request: OrderRequest) {
    return withSpan(this.traceRecorder, "order-service", "ConfirmOrder", async () => {
      const result = await this.orderService.confirmOrder(request.sagaId, request.orderId);
      return { success: result.success, error: result.error ?? "" };
    });
  }

  @GrpcMethod("OrderService", "CancelOrder")
  async cancelOrder(request: OrderRequest) {
    return withSpan(this.traceRecorder, "order-service", "CancelOrder", async () => {
      const result = await this.orderService.cancelOrder(request.sagaId, request.orderId);
      return { success: result.success, error: result.error ?? "" };
    });
  }
}
