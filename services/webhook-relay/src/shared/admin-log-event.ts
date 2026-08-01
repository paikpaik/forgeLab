// node-forge의 AdminEventBus<T>는 제네릭이라 이벤트 payload 형태를 모른다 —
// webhook-relay가 실제로 방송하는 이벤트 모양만 여기서 정의한다.
//
// delivery-worker는 SSE를 안 갖는다 — 호스트 포트가 없는 다중 인스턴스 프로세스라(의도적
// 스케일링 대상), order-outbox의 fulfillment처럼 자기 포트로 SSE를 노출하는 방식을 그대로
// 못 쓴다(스케일된 인스턴스마다 별도 스트림이 생겨서 패널이 어느 걸 구독해야 할지 애매해짐).
// 대신 배달 상태(성공/재시도/dead)는 이미 deliveries 테이블에 다 있어서 패널이 그걸
// 폴링하고, circuit breaker 상태는 Redis에 있어서 ingest가 직접 읽어 보여준다 — 별도 이벤트
// 릴레이 없이도 관측 공백이 없다. 그래서 SSE로 실제 방송하는 건 ingest 쪽 이벤트뿐이다.
export interface AdminLogEvent {
  type: "fanned_out" | "replayed";
  message: string;
  at: string;
}
