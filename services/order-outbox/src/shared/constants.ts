export const KAFKA_CLIENT_ID_API = "order-outbox-api";
export const KAFKA_CLIENT_ID_FULFILLMENT = "order-outbox-fulfillment";
export const FULFILLMENT_CONSUMER_GROUP_ID = "order-outbox-fulfillment";

export const KAFKA_INSTANCE = Symbol("KAFKA_INSTANCE");

export const OUTBOX_PUBLISH_INTERVAL_MS = Number(process.env.OUTBOX_PUBLISH_INTERVAL_MS ?? 5000);
export const OUTBOX_PUBLISH_BATCH_SIZE = Number(process.env.OUTBOX_PUBLISH_BATCH_SIZE ?? 50);

export const HEALTH_CHECK_CACHE_MS = 5000;
