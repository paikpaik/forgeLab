import { describe, it, expect, afterEach } from "vitest";
import type { DataSource } from "typeorm";
import { DistributedCircuitBreaker } from "@paikpaik/node-forge/redis";
import type { AdminEventBus } from "@paikpaik/node-forge/events";
import { createTestDataSource } from "../test-utils/create-test-data-source";
import { FakeRedisClient } from "../test-utils/fake-redis-client";
import { FakeHttpClient } from "../test-utils/fake-http-client";
import { PaymentService } from "./payment.service";
import { PaymentTransactionEntity } from "./entities/payment-transaction.entity";
import type { AdminLogEvent } from "../shared/admin-log-event";
import { MAX_RECONCILE_ATTEMPTS } from "../shared/constants";

let dataSource: DataSource;

afterEach(async () => {
  if (dataSource?.isInitialized) await dataSource.destroy();
});

async function getClientReference(paymentId: string): Promise<string> {
  const row = await dataSource.getRepository(PaymentTransactionEntity).findOneBy({ id: paymentId });
  return row!.clientReference;
}

function createFakeAdminEvents(): AdminEventBus<AdminLogEvent> {
  return { emit: () => {} } as unknown as AdminEventBus<AdminLogEvent>;
}

async function setup(failureThreshold = 3) {
  dataSource = await createTestDataSource();
  const httpClient = new FakeHttpClient();
  const circuitBreaker = new DistributedCircuitBreaker(new FakeRedisClient() as any, {
    failureThreshold,
    resetTimeout: 20_000,
  });
  const service = new PaymentService(dataSource, circuitBreaker, httpClient as any, createFakeAdminEvents());
  return { service, httpClient, circuitBreaker };
}

describe("PaymentService.createPayment", () => {
  it("PG가 동기 승인하면 CONFIRMED로 확정되고 성공 시도가 기록된다", async () => {
    const { service, httpClient } = await setup();
    httpClient.queuePostResolve({ pgTransactionId: "pg-1", status: "APPROVED" });

    const payment = await service.createPayment({ merchantId: "shop-1", amount: 1000 }, "v2");

    expect(payment.status).toBe("CONFIRMED");
    const attempts = await service.listAttempts(payment.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe("SUCCESS");
  });

  it("PG가 명시적으로 거절(에러 응답)하면 IN_DOUBT가 아니라 바로 FAILED로 확정된다", async () => {
    const { service, httpClient } = await setup();
    httpClient.queuePostRejectResponse(500);

    const payment = await service.createPayment({ merchantId: "shop-1", amount: 1000 }, "v2");

    expect(payment.status).toBe("FAILED");
    const attempts = await service.listAttempts(payment.id);
    expect(attempts[0].outcome).toBe("PG_ERROR");
  });

  it("PG 응답 자체를 못 받으면(타임아웃) IN_DOUBT로 남는다 — 모호하므로 함부로 확정하지 않는다", async () => {
    const { service, httpClient } = await setup();
    httpClient.queuePostRejectNoResponse();

    const payment = await service.createPayment({ merchantId: "shop-1", amount: 1000 }, "v2");

    expect(payment.status).toBe("IN_DOUBT");
    const attempts = await service.listAttempts(payment.id);
    expect(attempts[0].outcome).toBe("TIMEOUT");
  });

  // 이 실험의 핵심 — 회로가 이미 OPEN이면 PG 호출 자체를 안 하므로 그 자리에서 바로
  // FAILED(모호함 없음)로 처리하고, 실제로 PG를 다시 두드리지 않아야 한다.
  it("회로가 OPEN이면 PG를 호출하지 않고 즉시 FAILED로 처리한다", async () => {
    const { service, httpClient } = await setup(1); // 실패 1회로 바로 OPEN
    httpClient.queuePostRejectResponse(500);
    await service.createPayment({ merchantId: "shop-1", amount: 1000 }, "v2");
    expect(httpClient.postCallCount).toBe(1);

    const secondPayment = await service.createPayment({ merchantId: "shop-1", amount: 2000 }, "v2");

    expect(secondPayment.status).toBe("FAILED");
    expect(httpClient.postCallCount).toBe(1); // 회로가 OPEN이라 두 번째는 PG를 아예 안 부름
    const attempts = await service.listAttempts(secondPayment.id);
    expect(attempts[0].outcome).toBe("CIRCUIT_OPEN");
  });

  it("같은 idempotencyKey로 재요청하면 새 결제를 만들지 않고 기존 상태를 반환한다", async () => {
    const { service, httpClient } = await setup();
    httpClient.queuePostResolve({ pgTransactionId: "pg-1", status: "APPROVED" });

    const first = await service.createPayment({ merchantId: "shop-1", amount: 1000, idempotencyKey: "key-1" }, "v2");
    const second = await service.createPayment({ merchantId: "shop-1", amount: 1000, idempotencyKey: "key-1" }, "v2");

    expect(second.id).toBe(first.id);
    expect(httpClient.postCallCount).toBe(1); // 두 번째 요청은 PG를 다시 안 부름
  });

  it("v1로 요청하면 id/status만 담긴 플랫 응답을 받는다", async () => {
    const { service, httpClient } = await setup();
    httpClient.queuePostResolve({ pgTransactionId: "pg-1", status: "APPROVED" });

    const payment = await service.createPayment({ merchantId: "shop-1", amount: 1000 }, "v1");

    expect(Object.keys(payment).sort()).toEqual(["id", "status"]);
  });
});

describe("PaymentService.reconcile", () => {
  it("IN_DOUBT 거래를 거래조회로 확인해서 CONFIRMED로 해소한다", async () => {
    const { service, httpClient } = await setup();
    httpClient.queuePostRejectNoResponse();
    const payment = await service.createPayment({ merchantId: "shop-1", amount: 1000 }, "v2");
    expect(payment.status).toBe("IN_DOUBT");

    httpClient.queueGetResolve({ clientReference: "ref", pgTransactionId: "pg-1", status: "APPROVED" });
    const reconciled = await service.reconcile(payment.id);

    expect(reconciled).toBe(true);
    const updated = await service.getPayment(payment.id, "v2");
    expect(updated.status).toBe("CONFIRMED");
  });

  // 실제 Docker 검증 중 재현된 케이스 — ForgeHttpClient의 재시도가 원래 요청 대신
  // "PROCESSING" 응답을 받아버리면 거래는 PENDING에 pgTransactionId만 채워진 채로 멈춘다.
  // 이 경우엔 아무도 웹훅을 보내주지 않으므로(비동기 접수 시나리오가 아니라 재시도가 우연히
  // 잡아챈 것일 뿐) reconciler가 IN_DOUBT와 동일하게 이 상태도 조회 대상으로 집어야 한다.
  it("PENDING+pgTransactionId 상태(재시도가 PROCESSING을 가로챈 경우)도 거래조회 대상에 포함되어 해소된다", async () => {
    const { service, httpClient } = await setup();
    httpClient.queuePostResolve({ pgTransactionId: "pg-stuck-1", status: "PROCESSING" });
    const payment = await service.createPayment({ merchantId: "shop-1", amount: 1000 }, "v2");
    expect(payment.status).toBe("PENDING");

    const targets = await service.listInDoubt();
    expect(targets.map((t) => t.id)).toContain(payment.id);

    httpClient.queueGetResolve({ clientReference: "ref", pgTransactionId: "pg-stuck-1", status: "APPROVED" });
    const reconciled = await service.reconcile(payment.id);

    expect(reconciled).toBe(true);
    const updated = await service.getPayment(payment.id, "v2");
    expect(updated.status).toBe("CONFIRMED");
  });

  it("거래조회가 계속 해소 안 되면 MAX_RECONCILE_ATTEMPTS번째에 DEAD로 넘어간다", async () => {
    const { service, httpClient } = await setup();
    httpClient.queuePostRejectNoResponse();
    const payment = await service.createPayment({ merchantId: "shop-1", amount: 1000 }, "v2");

    for (let i = 0; i < MAX_RECONCILE_ATTEMPTS; i++) {
      httpClient.queueGetResolve({ clientReference: "ref", pgTransactionId: "", status: "UNKNOWN" });
      await service.reconcile(payment.id);
    }

    const updated = await service.getPayment(payment.id, "v2");
    expect(updated.status).toBe("DEAD");
  });
});

describe("PaymentService.handleWebhookCallback", () => {
  it("비동기 접수(PENDING) 거래에 웹훅이 도착하면 최종 상태로 전이한다", async () => {
    const { service, httpClient } = await setup();
    httpClient.queuePostResolve({ pgTransactionId: "pg-async-1", status: "PROCESSING" });
    const payment = await service.createPayment({ merchantId: "shop-1", amount: 1000 }, "v2");
    expect(payment.status).toBe("PENDING");

    const clientReference = await getClientReference(payment.id);
    const result = await service.handleWebhookCallback({
      clientReference,
      pgTransactionId: "pg-async-1",
      status: "APPROVED",
    });

    expect(result.handled).toBe(true);
    const finalState = await service.getPayment(payment.id, "v2");
    expect(finalState.status).toBe("CONFIRMED");
  });

  it("이미 처리된(PENDING이 아닌) 거래에 중복 웹훅이 오면 무시한다", async () => {
    const { service, httpClient } = await setup();
    httpClient.queuePostResolve({ pgTransactionId: "pg-1", status: "APPROVED" });
    const payment = await service.createPayment({ merchantId: "shop-1", amount: 1000 }, "v2");
    expect(payment.status).toBe("CONFIRMED");

    const clientReference = await getClientReference(payment.id);
    const result = await service.handleWebhookCallback({ clientReference, pgTransactionId: "pg-1", status: "DECLINED" });

    expect(result.handled).toBe(false);
    const unchanged = await service.getPayment(payment.id, "v2");
    expect(unchanged.status).toBe("CONFIRMED"); // 중복 웹훅으로 덮어써지지 않는다
  });
});
