import { z } from "zod";
import { createTopicName, defineEvent } from "@paikpaik/kafka-forge";

// 이 이벤트는 도메인 이벤트 자체가 아니라 "이 Delivery를 최초로 시도해봐라"는 내부 트리거다.
// 실제 도메인 이벤트(type/payload)는 DB의 EventEntity에 있고, 여기서는 조회에 필요한
// deliveryId만 옮긴다 — 페이로드를 Kafka에 중복 보관하지 않기 위함.
export const DispatchTriggerSchema = z.object({
  deliveryId: z.string().uuid(),
});

export type DispatchTriggerPayload = z.infer<typeof DispatchTriggerSchema>;

export const DispatchTrigger = defineEvent({
  topic: createTopicName("webhook", "deliveries", 1),
  schema: DispatchTriggerSchema,
  partitionKey: (payload) => payload.deliveryId,
});
