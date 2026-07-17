import { describe, it, expect } from "vitest";
import { ScoreEvent, ScoreEventSchema } from "./score-event.contract";

describe("ScoreEvent 토픽/스키마", () => {
  it("토픽명은 createTopicName 컨벤션(<domain>.<event>.v<N>)을 따른다", () => {
    expect(ScoreEvent.topic).toBe("ranking.score-events.v1");
  });

  it("partitionKey는 leaderboardId를 그대로 사용한다", () => {
    const payload = {
      eventId: "5f8d3a2e-3b9a-4c2b-9b0e-000000000001",
      leaderboardId: "default",
      userId: "u1",
      delta: 10,
    };
    expect(ScoreEvent.partitionKey(payload)).toBe("default");
  });

  it("정상 payload는 스키마 검증을 통과한다", () => {
    const result = ScoreEventSchema.safeParse({
      eventId: "5f8d3a2e-3b9a-4c2b-9b0e-000000000001",
      leaderboardId: "default",
      userId: "u1",
      delta: -5,
    });
    expect(result.success).toBe(true);
  });

  it("eventId가 uuid 형식이 아니면 검증에 실패한다", () => {
    const result = ScoreEventSchema.safeParse({
      eventId: "not-a-uuid",
      leaderboardId: "default",
      userId: "u1",
      delta: 5,
    });
    expect(result.success).toBe(false);
  });

  it("delta가 정수가 아니면 검증에 실패한다", () => {
    const result = ScoreEventSchema.safeParse({
      eventId: "5f8d3a2e-3b9a-4c2b-9b0e-000000000001",
      leaderboardId: "default",
      userId: "u1",
      delta: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("userId가 빈 문자열이면 검증에 실패한다", () => {
    const result = ScoreEventSchema.safeParse({
      eventId: "5f8d3a2e-3b9a-4c2b-9b0e-000000000001",
      leaderboardId: "default",
      userId: "",
      delta: 5,
    });
    expect(result.success).toBe(false);
  });
});
