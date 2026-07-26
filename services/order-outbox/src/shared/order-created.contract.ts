import { z } from "zod";
import { createTopicName, defineEvent } from "@paikpaik/kafka-forge";

export const OrderCreatedSchema = z.object({
  orderId: z.string().uuid(),
  item: z.string().min(1),
  amount: z.number().int().positive(),
  createdAt: z.string(),
});

export type OrderCreatedPayload = z.infer<typeof OrderCreatedSchema>;

// 토픽명은 kafka-forge 컨벤션(createTopicName)을 거쳐서만 만든다.
export const OrderCreated = defineEvent({
  topic: createTopicName("order", "created", 1),
  schema: OrderCreatedSchema,
  partitionKey: (payload) => payload.orderId,
});
