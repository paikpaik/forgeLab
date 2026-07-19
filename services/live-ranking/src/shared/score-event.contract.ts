import { z } from "zod";
import type { EventContract } from "@paikpaik/kafka-forge";
import { createTopicName, defineEvent, toDlqTopicName } from "@paikpaik/kafka-forge";

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

export const DlqEnvelopeSchema = z.object({
  payload: ScoreEventSchema,
  error: z.string(),
  failedAt: z.string(),
});

export type DlqEnvelope = z.infer<typeof DlqEnvelopeSchema>;

// toDlqTopicName()이 만드는 "<topic>.dlq" 형태는 kafka-forge 자신의 토픽 네이밍 컨벤션
// (<domain>.<event>.v<N>)을 따르지 않아서, defineEvent()로 만들면 내부 assertValidTopicName이
// 던진다. EventContract는 순수 인터페이스라 defineEvent()를 거치지 않고 리터럴로 직접 만들어서
// 이 검증을 우회한다 — 이 토픽은 우리가 만드는 게 아니라 StandardConsumer가 파생시키는
// 토픽이라, 애초에 우리 쪽 네이밍 컨벤션의 대상이 아니라고 판단했다.
export const ScoreEventDlq: EventContract<typeof DlqEnvelopeSchema> = {
  topic: toDlqTopicName(ScoreEvent.topic),
  schema: DlqEnvelopeSchema,
  partitionKey: (envelope) => envelope.payload.leaderboardId,
};
