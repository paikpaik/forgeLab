import { Controller, UseInterceptors } from "@nestjs/common";
import { GrpcMethod } from "@nestjs/microservices";
import { GrpcTraceAccessLogInterceptor } from "@paikpaik/node-forge/grpc/nestjs";
import { InventoryService } from "./inventory.service";
import { TraceRecorderService, withSpan } from "../shared/trace-recorder";

interface TryReserveRequest {
  sagaId: string;
  productId: string;
  quantity: number;
}

interface ReservationRequest {
  sagaId: string;
  reservationId: string;
}

interface ResetStockRequest {
  productId: string;
  total: number;
}

interface GetStockRequest {
  productId: string;
}

@Controller()
@UseInterceptors(GrpcTraceAccessLogInterceptor)
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly traceRecorder: TraceRecorderService,
  ) {}

  @GrpcMethod("InventoryService", "TryReserve")
  async tryReserve(request: TryReserveRequest) {
    return withSpan(this.traceRecorder, "inventory-service", "TryReserve", async () => {
      const result = await this.inventoryService.tryReserve(request.sagaId, request.productId, request.quantity);
      return { success: result.success, reservationId: result.reservationId ?? "", error: result.error ?? "" };
    });
  }

  @GrpcMethod("InventoryService", "ConfirmReserve")
  async confirmReserve(request: ReservationRequest) {
    return withSpan(this.traceRecorder, "inventory-service", "ConfirmReserve", async () => {
      const result = await this.inventoryService.confirmReserve(request.sagaId, request.reservationId);
      return { success: result.success, error: result.error ?? "" };
    });
  }

  @GrpcMethod("InventoryService", "CancelReserve")
  async cancelReserve(request: ReservationRequest) {
    return withSpan(this.traceRecorder, "inventory-service", "CancelReserve", async () => {
      const result = await this.inventoryService.cancelReserve(request.sagaId, request.reservationId);
      return { success: result.success, error: result.error ?? "" };
    });
  }

  @GrpcMethod("InventoryService", "ResetStock")
  async resetStock(request: ResetStockRequest) {
    return withSpan(this.traceRecorder, "inventory-service", "ResetStock", async () => {
      const result = await this.inventoryService.resetStock(request.productId, request.total);
      return { success: result.success, error: result.error ?? "" };
    });
  }

  @GrpcMethod("InventoryService", "GetStock")
  async getStock(request: GetStockRequest) {
    return withSpan(this.traceRecorder, "inventory-service", "GetStock", async () => {
      const stock = await this.inventoryService.getStock(request.productId);
      return {
        found: stock.found,
        productId: request.productId,
        total: stock.total,
        reserved: stock.reserved,
        available: stock.total - stock.reserved,
      };
    });
  }
}
