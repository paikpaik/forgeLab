import { Injectable } from "@nestjs/common";
import { InjectRedis } from "@paikpaik/node-forge/redis/nestjs";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import { getRequestContext } from "@paikpaik/node-forge/core";

export interface TraceSpan {
  service: string;
  method: string;
  ok: boolean;
  durationMs: number;
  at: string;
}

const TRACE_TTL_SECONDS = 3600;
const MAX_SPANS_PER_TRACE = 50;

function traceSpansKey(traceId: string): string {
  return `trace:${traceId}:spans`;
}

// gateway/orchestrator/order-service/inventory-service 4개 프로세스가 전부 이 서비스를
// 통해 자기 트레이스 스팬을 기록한다 — 도메인 데이터(주문/재고/saga)는 여전히 전부
// Postgres에 있고, Redis는 순수하게 "폴러 경계를 넘어 이어붙인 트레이스"를 조회 가능하게
// 보여주기 위한 용도로만 쓴다.
@Injectable()
export class TraceRecorderService {
  constructor(@InjectRedis() private readonly redis: ForgeRedisClient) {}

  async recordSpan(service: string, method: string, ok: boolean, durationMs: number): Promise<void> {
    // 트레이스 컨텍스트 밖(스케줄러 등에서 재수립 없이 직접 부른 경우)이면 기록할 traceId가
    // 없으므로 조용히 스킵한다 — 이 자체는 정상 상황(예: 헬스체크)이라 에러로 취급하지 않는다.
    const traceId = getRequestContext()?.traceId;
    if (!traceId) return;

    const span: TraceSpan = { service, method, ok, durationMs, at: new Date().toISOString() };
    const key = traceSpansKey(traceId);
    await this.redis.rpush(key, span);
    await this.redis.ltrim(key, -MAX_SPANS_PER_TRACE, -1);
    await this.redis.expire(key, TRACE_TTL_SECONDS);
  }

  async getSpans(traceId: string): Promise<TraceSpan[]> {
    return this.redis.lrange<TraceSpan>(traceSpansKey(traceId), 0, -1);
  }
}

// 컨트롤러 메서드 하나를 감싸서 실행 시간을 재고, 성공/실패 여부와 함께 스팬으로 기록한다.
// 원래 메서드의 반환값/예외는 그대로 전달한다(계측이 비즈니스 로직에 개입하지 않음).
export async function withSpan<T>(
  recorder: TraceRecorderService,
  service: string,
  method: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    await recorder.recordSpan(service, method, true, Date.now() - start);
    return result;
  } catch (err) {
    await recorder.recordSpan(service, method, false, Date.now() - start);
    throw err;
  }
}
