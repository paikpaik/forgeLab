import { describe, it, expect } from "vitest";
import { OrderCreated, OrderCreatedSchema } from "./order-created.contract";

describe("OrderCreated 토픽/스키마", () => {
  it("토픽명은 createTopicName 컨벤션을 따른다", () => {
    expect(OrderCreated.topic).toBe("order.created.v1");
  });

  it("partitionKey는 orderId를 그대로 사용한다", () => {
    expect(
      OrderCreated.partitionKey({
        orderId: "5f8d3a2e-3b9a-4c2b-9b0e-000000000001",
        item: "키보드",
        amount: 1,
        createdAt: new Date().toISOString(),
      }),
    ).toBe("5f8d3a2e-3b9a-4c2b-9b0e-000000000001");
  });

  it("정상 payload는 스키마 검증을 통과한다", () => {
    const result = OrderCreatedSchema.safeParse({
      orderId: "5f8d3a2e-3b9a-4c2b-9b0e-000000000001",
      item: "키보드",
      amount: 2,
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("amount가 0 이하면 검증에 실패한다", () => {
    const result = OrderCreatedSchema.safeParse({
      orderId: "5f8d3a2e-3b9a-4c2b-9b0e-000000000001",
      item: "키보드",
      amount: 0,
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it("orderId가 uuid 형식이 아니면 검증에 실패한다", () => {
    const result = OrderCreatedSchema.safeParse({
      orderId: "not-a-uuid",
      item: "키보드",
      amount: 1,
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });
});
