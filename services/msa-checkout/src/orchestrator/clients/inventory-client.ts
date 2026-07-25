export interface TryReserveResult {
  success: boolean;
  reservationId?: string;
  error?: string;
}

export interface InventoryActionResult {
  success: boolean;
  error?: string;
}

export interface InventoryClient {
  tryReserve(sagaId: string, productId: string, quantity: number): Promise<TryReserveResult>;
  confirmReserve(sagaId: string, reservationId: string): Promise<InventoryActionResult>;
  cancelReserve(sagaId: string, reservationId: string): Promise<InventoryActionResult>;
}

export const INVENTORY_CLIENT = Symbol("INVENTORY_CLIENT");
