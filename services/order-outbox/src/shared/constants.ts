export const KAFKA_CLIENT_ID_API = "order-outbox-api";
export const KAFKA_CLIENT_ID_FULFILLMENT = "order-outbox-fulfillment";
export const FULFILLMENT_CONSUMER_GROUP_ID = "order-outbox-fulfillment";

export const KAFKA_INSTANCE = Symbol("KAFKA_INSTANCE");

export const OUTBOX_PUBLISH_INTERVAL_MS = Number(process.env.OUTBOX_PUBLISH_INTERVAL_MS ?? 5000);
export const OUTBOX_PUBLISH_BATCH_SIZE = Number(process.env.OUTBOX_PUBLISH_BATCH_SIZE ?? 50);
// 이 횟수만큼 실패하면 더 이상 재시도하지 않고 "죽은" 레코드로 격리한다(kafka-forge 1.0.5의
// markFailed 훅으로 가능해짐). "몇 번이면 포기할지"는 kafka-forge가 정하지 않고 우리 store가
// 정하는 정책이라 여기 상수로 둔다.
export const OUTBOX_MAX_ATTEMPTS = 5;

export const HEALTH_CHECK_CACHE_MS = 5000;

// panel.html의 "발행 실패 유발" 버튼이 이 상품명으로 주문하면, OrdersService가 일부러
// 유효하지 않은 토픽으로 outbox row를 만든다 — OutboxPublisher의 markFailed/dead-lettering이
// 실제로 동작하는지 raw SQL 없이도 눈으로 확인하기 위한 테스트/데모 전용 트리거.
export const OUTBOX_POISON_ITEM = "__outbox-fail__";
export const OUTBOX_POISON_TOPIC = "invalid topic name!!!";
