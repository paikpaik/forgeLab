export interface TryCreateOrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
}

export interface OrderActionResult {
  success: boolean;
  error?: string;
}

// 실제 구현(OrderGrpcClient)과 테스트용 fake가 공유하는 인터페이스 — 이 랩 전체에서 써온
// "저장소/외부 클라이언트는 인터페이스로 분리해서 fake로 테스트한다" 패턴을 gRPC 클라이언트에도
// 그대로 적용한다.
export interface OrderClient {
  tryCreateOrder(sagaId: string, userId: string, productId: string, quantity: number): Promise<TryCreateOrderResult>;
  confirmOrder(sagaId: string, orderId: string): Promise<OrderActionResult>;
  cancelOrder(sagaId: string, orderId: string): Promise<OrderActionResult>;
}

export const ORDER_CLIENT = Symbol("ORDER_CLIENT");
