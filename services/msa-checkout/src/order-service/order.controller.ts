import { Controller, UseInterceptors } from "@nestjs/common";
import { GrpcMethod } from "@nestjs/microservices";
import { GrpcTraceAccessLogInterceptor } from "@paikpaik/node-forge/grpc/nestjs";
import { OrderService } from "./order.service";

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
  constructor(private readonly orderService: OrderService) {}

  @GrpcMethod("OrderService", "TryCreateOrder")
  async tryCreateOrder(request: TryCreateOrderRequest) {
    const result = await this.orderService.tryCreateOrder(
      request.sagaId,
      request.userId,
      request.productId,
      request.quantity,
    );
    return { success: result.success, orderId: result.orderId ?? "", error: result.error ?? "" };
  }

  @GrpcMethod("OrderService", "ConfirmOrder")
  async confirmOrder(request: OrderRequest) {
    const result = await this.orderService.confirmOrder(request.sagaId, request.orderId);
    return { success: result.success, error: result.error ?? "" };
  }

  @GrpcMethod("OrderService", "CancelOrder")
  async cancelOrder(request: OrderRequest) {
    const result = await this.orderService.cancelOrder(request.sagaId, request.orderId);
    return { success: result.success, error: result.error ?? "" };
  }
}
