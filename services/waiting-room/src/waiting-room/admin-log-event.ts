// node-forge의 AdminEventBus<T>는 제네릭이라 이벤트 payload 형태를 모른다 —
// waiting-room이 실제로 방송하는 이벤트 모양만 여기서 정의한다.
export interface AdminLogEvent {
  type: "joined" | "admitted";
  message: string;
  at: string;
}
