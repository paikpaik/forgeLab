import { Injectable, Logger } from "@nestjs/common";
import { InjectDataSource } from "@paikpaik/node-forge/database/nestjs";
import type { DataSource } from "typeorm";
import { DeliveryEntity } from "../entities/delivery.entity";
import { EndpointEntity } from "../entities/endpoint.entity";
import { EventEntity } from "../entities/event.entity";
import { DistributedCircuitBreaker } from "@paikpaik/node-forge/redis";
import { signPayload } from "../shared/hmac";
import { CIRCUIT_RESET_TIMEOUT_MS, MAX_DELIVERY_ATTEMPTS, nextBackoffMs } from "../shared/constants";

const HTTP_TIMEOUT_MS = 5000;

@Injectable()
export class DeliveryAttemptService {
  private readonly logger = new Logger(DeliveryAttemptService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly circuitBreaker: DistributedCircuitBreaker,
  ) {}

  // Kafka consumer(최초 시도)와 재시도 폴러(delivery-worker의 @Interval) 둘 다 이 메서드
  // 하나로 들어온다 — "최초 시도"와 "재시도"가 로직상 다를 이유가 없다(둘 다 그냥 한 번의
  // 배달 시도일 뿐). status가 이미 pending이 아니면(다른 인스턴스가 먼저 처리했거나 이미
  // 끝난 delivery) 조용히 스킵한다 — 여러 인스턴스가 같은 deliveryId를 동시에 집어도
  // 안전하다(TypeORM update 자체가 원자적이라 마지막에 쓴 쪽이 이기는 정도의 경합만 있음,
  // 이 실험에서 완벽한 분산 락까지는 다루지 않음 — circuit breaker 공유가 핵심 검증 대상).
  async attempt(deliveryId: string): Promise<void> {
    const repo = this.dataSource.getRepository(DeliveryEntity);
    const delivery = await repo.findOneBy({ id: deliveryId });
    if (!delivery || delivery.status !== "pending") return;

    const endpoint = await this.dataSource.getRepository(EndpointEntity).findOneBy({ id: delivery.endpointId });
    const event = await this.dataSource.getRepository(EventEntity).findOneBy({ id: delivery.eventId });
    if (!endpoint || !event) {
      this.logger.warn(`delivery=${deliveryId}의 endpoint/event를 찾을 수 없음 — 스킵`);
      return;
    }

    const circuitState = await this.circuitBreaker.getState(endpoint.id);
    if (circuitState === "OPEN") {
      // 회로가 열려있으면 HTTP 호출 자체를 안 한다 — 죽은 엔드포인트를 계속 두드리지 않기
      // 위한 circuit breaker 본연의 목적. attempts는 늘리지 않는다(엔드포인트가 실제로
      // 응답할 기회를 못 받았으니 "실패"로 세는 건 부당함) — 대신 회로가 풀릴 시점 근처로
      // nextAttemptAt만 미룬다.
      await repo.update(deliveryId, {
        nextAttemptAt: new Date(Date.now() + CIRCUIT_RESET_TIMEOUT_MS).toISOString(),
        lastError: "circuit open — 재시도 보류",
      });
      return;
    }

    const rawBody = JSON.stringify({
      eventId: event.id,
      type: event.type,
      payload: event.payload,
      createdAt: event.createdAt,
    });
    const signature = signPayload(rawBody, endpoint.secret);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-webhook-signature": signature },
        body: rawBody,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        await repo.update(deliveryId, {
          status: "success",
          attempts: delivery.attempts + 1,
          lastAttemptAt: new Date().toISOString(),
          responseStatus: res.status,
          lastError: null,
          nextAttemptAt: null,
        });
        await this.circuitBreaker.recordSuccess(endpoint.id);
      } else {
        await this.handleFailure(delivery, `HTTP ${res.status}`, res.status, endpoint.id);
      }
    } catch (err) {
      clearTimeout(timeout);
      const message = (err as Error).name === "AbortError" ? "요청 타임아웃" : (err as Error).message;
      await this.handleFailure(delivery, message, null, endpoint.id);
    }
  }

  private async handleFailure(
    delivery: DeliveryEntity,
    errorMessage: string,
    responseStatus: number | null,
    endpointId: string,
  ): Promise<void> {
    const attempts = delivery.attempts + 1;
    await this.circuitBreaker.recordFailure(endpointId);

    const repo = this.dataSource.getRepository(DeliveryEntity);
    if (attempts >= MAX_DELIVERY_ATTEMPTS) {
      await repo.update(delivery.id, {
        status: "dead",
        attempts,
        lastAttemptAt: new Date().toISOString(),
        lastError: errorMessage,
        responseStatus,
        nextAttemptAt: null,
      });
      return;
    }

    const nextAttemptAt = new Date(Date.now() + nextBackoffMs(attempts)).toISOString();
    await repo.update(delivery.id, {
      status: "pending",
      attempts,
      lastAttemptAt: new Date().toISOString(),
      lastError: errorMessage,
      responseStatus,
      nextAttemptAt,
    });
  }
}
