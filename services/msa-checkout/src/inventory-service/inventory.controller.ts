import { Controller } from "@nestjs/common";
import { GrpcMethod } from "@nestjs/microservices";
import { InventoryService } from "./inventory.service";

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
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @GrpcMethod("InventoryService", "TryReserve")
  async tryReserve(request: TryReserveRequest) {
    const result = await this.inventoryService.tryReserve(request.sagaId, request.productId, request.quantity);
    return { success: result.success, reservationId: result.reservationId ?? "", error: result.error ?? "" };
  }

  @GrpcMethod("InventoryService", "ConfirmReserve")
  async confirmReserve(request: ReservationRequest) {
    const result = await this.inventoryService.confirmReserve(request.sagaId, request.reservationId);
    return { success: result.success, error: result.error ?? "" };
  }

  @GrpcMethod("InventoryService", "CancelReserve")
  async cancelReserve(request: ReservationRequest) {
    const result = await this.inventoryService.cancelReserve(request.sagaId, request.reservationId);
    return { success: result.success, error: result.error ?? "" };
  }

  @GrpcMethod("InventoryService", "ResetStock")
  async resetStock(request: ResetStockRequest) {
    const result = await this.inventoryService.resetStock(request.productId, request.total);
    return { success: result.success, error: result.error ?? "" };
  }

  @GrpcMethod("InventoryService", "GetStock")
  async getStock(request: GetStockRequest) {
    const stock = await this.inventoryService.getStock(request.productId);
    return {
      found: stock.found,
      productId: request.productId,
      total: stock.total,
      reserved: stock.reserved,
      available: stock.total - stock.reserved,
    };
  }
}
