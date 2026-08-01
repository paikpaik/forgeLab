import { randomUUID } from "node:crypto";
import { describe, it, expect, afterEach, vi } from "vitest";
import type { DataSource } from "typeorm";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import { DistributedCircuitBreaker } from "@paikpaik/node-forge/redis";
import { createTestDataSource } from "../test-utils/create-test-data-source";
import { FakeRedisClient } from "../test-utils/fake-redis-client";
import { EndpointEntity } from "../entities/endpoint.entity";
import { EventEntity } from "../entities/event.entity";
import { DeliveryEntity } from "../entities/delivery.entity";
import { CIRCUIT_FAILURE_THRESHOLD, CIRCUIT_RESET_TIMEOUT_MS } from "../shared/constants";
import { DeliveryAttemptService } from "./delivery-attempt.service";

let dataSource: DataSource;

afterEach(async () => {
  vi.unstubAllGlobals();
  if (dataSource?.isInitialized) await dataSource.destroy();
});

async function seed(ds: DataSource) {
  const endpoint = await ds.getRepository(EndpointEntity).save({
    id: randomUUID(),
    tenantId: "t1",
    url: "http://example.com/hook",
    secret: "s",
    eventTypes: ["*"],
    active: true,
  });
  const event = await ds.getRepository(EventEntity).save({
    id: randomUUID(),
    tenantId: "t1",
    type: "order.created",
    payload: { x: 1 },
  });
  const delivery = await ds.getRepository(DeliveryEntity).save({
    id: randomUUID(),
    eventId: event.id,
    endpointId: endpoint.id,
    tenantId: "t1",
    status: "pending",
    attempts: 0,
    nextAttemptAt: null,
    lastAttemptAt: null,
    lastError: null,
    responseStatus: null,
  });
  return { endpoint, event, delivery };
}

function createService(ds: DataSource) {
  const redis = new FakeRedisClient();
  const circuitBreaker = new DistributedCircuitBreaker(redis as unknown as ForgeRedisClient, {
    failureThreshold: CIRCUIT_FAILURE_THRESHOLD,
    resetTimeout: CIRCUIT_RESET_TIMEOUT_MS,
  });
  return { service: new DeliveryAttemptService(ds, circuitBreaker), circuitBreaker };
}

describe("DeliveryAttemptService.attempt", () => {
  it("존재하지 않는 delivery는 조용히 무시한다", async () => {
    dataSource = await createTestDataSource();
    const { service } = createService(dataSource);
    await expect(service.attempt("no-such-id")).resolves.toBeUndefined();
  });

  it("이미 pending이 아닌(끝난) delivery는 다시 시도하지 않는다", async () => {
    dataSource = await createTestDataSource();
    const { delivery } = await seed(dataSource);
    await dataSource.getRepository(DeliveryEntity).update(delivery.id, { status: "success" });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { service } = createService(dataSource);
    await service.attempt(delivery.id);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("2xx 응답을 받으면 success로 전이하고 circuit breaker에 성공을 기록한다", async () => {
    dataSource = await createTestDataSource();
    const { delivery } = await seed(dataSource);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const { service, circuitBreaker } = createService(dataSource);
    await service.attempt(delivery.id);

    const updated = await dataSource.getRepository(DeliveryEntity).findOneBy({ id: delivery.id });
    expect(updated).toMatchObject({ status: "success", attempts: 1, responseStatus: 200, lastError: null });
    expect(await circuitBreaker.getState(delivery.endpointId)).toBe("CLOSED");
  });

  it("실패 응답이면 attempts를 늘리고 백오프로 nextAttemptAt을 예약한다(MAX_DELIVERY_ATTEMPTS 미만)", async () => {
    dataSource = await createTestDataSource();
    const { delivery } = await seed(dataSource);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const { service } = createService(dataSource);
    await service.attempt(delivery.id);

    const updated = await dataSource.getRepository(DeliveryEntity).findOneBy({ id: delivery.id });
    expect(updated?.status).toBe("pending");
    expect(updated?.attempts).toBe(1);
    expect(updated?.responseStatus).toBe(500);
    expect(updated?.nextAttemptAt).not.toBeNull();
  });

  it("MAX_DELIVERY_ATTEMPTS(기본 5)에 도달하면 dead로 전이한다", async () => {
    // 기본 CIRCUIT_FAILURE_THRESHOLD(3)가 MAX_DELIVERY_ATTEMPTS(5)보다 작아서, 회로가
    // 먼저 열려버리면 그 다음 시도들은 실제 실패가 아니라 "회로 열림으로 보류"가 되어
    // attempts가 5까지 못 간다(별도 테스트로 이미 검증한 정상 동작). 이 테스트는 attempts가
    // 실제로 5에 도달했을 때 dead로 전이하는 로직만 격리해서 보고 싶으므로, 매 실패 뒤
    // circuit을 recordSuccess로 리셋해서 회로가 끼어들지 않게 한다.
    dataSource = await createTestDataSource();
    const { delivery } = await seed(dataSource);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const { service, circuitBreaker } = createService(dataSource);

    for (let i = 0; i < 5; i++) {
      await service.attempt(delivery.id);
      await circuitBreaker.recordSuccess(delivery.endpointId);
    }

    const updated = await dataSource.getRepository(DeliveryEntity).findOneBy({ id: delivery.id });
    expect(updated?.status).toBe("dead");
    expect(updated?.attempts).toBe(5);
  });

  it("circuit이 OPEN이면 HTTP 호출 없이 attempts 변화 없이 재시도만 미룬다", async () => {
    dataSource = await createTestDataSource();
    const { delivery } = await seed(dataSource);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { service, circuitBreaker } = createService(dataSource);
    await circuitBreaker.recordFailure(delivery.endpointId);
    await circuitBreaker.recordFailure(delivery.endpointId);
    await circuitBreaker.recordFailure(delivery.endpointId); // 임계치 도달 → OPEN

    await service.attempt(delivery.id);

    expect(fetchMock).not.toHaveBeenCalled();
    const updated = await dataSource.getRepository(DeliveryEntity).findOneBy({ id: delivery.id });
    expect(updated?.attempts).toBe(0);
    expect(updated?.status).toBe("pending");
    expect(updated?.lastError).toContain("circuit open");
    expect(updated?.nextAttemptAt).not.toBeNull();
  });

  it("네트워크 에러(fetch reject)도 실패로 처리되어 재시도가 예약된다", async () => {
    dataSource = await createTestDataSource();
    const { delivery } = await seed(dataSource);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const { service } = createService(dataSource);
    await service.attempt(delivery.id);

    const updated = await dataSource.getRepository(DeliveryEntity).findOneBy({ id: delivery.id });
    expect(updated?.status).toBe("pending");
    expect(updated?.attempts).toBe(1);
    expect(updated?.lastError).toContain("network down");
  });
});
