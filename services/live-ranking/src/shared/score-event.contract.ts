import { z } from "zod";
import { createTopicName, defineEvent } from "@paikpaik/kafka-forge";

export const ScoreEventSchema = z.object({
  eventId: z.string().uuid(),
  leaderboardId: z.string().min(1),
  userId: z.string().min(1),
  delta: z.number().int(),
});

export type ScoreEventPayload = z.infer<typeof ScoreEventSchema>;

// 토픽명은 kafka-forge 컨벤션(createTopicName)을 거쳐서만 만든다 — 직접 문자열로 하드코딩하지 않는다.
export const ScoreEvent = defineEvent({
  topic: createTopicName("ranking", "score-events", 1),
  schema: ScoreEventSchema,
  // 같은 리더보드의 이벤트는 같은 파티션으로 모아서, 파티션 단위 관측(랙 등)이 리더보드 단위로 단순해지게 한다.
  partitionKey: (payload) => payload.leaderboardId,
});
