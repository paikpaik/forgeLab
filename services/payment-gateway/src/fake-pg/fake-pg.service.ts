import { randomUUID } from "node:crypto";
import { HttpException, Inject, Injectable, Logger } from "@nestjs/common";
import type { ForgeHttpClient } from "@paikpaik/node-forge/http";
import { CALLBACK_HTTP_CLIENT } from "./fake-pg.constants";
import type { FakePgConfigDto } from "./dto/fake-pg-config.dto";

type PgStatus = "PROCESSING" | "APPROVED" | "DECLINED";
type InquiryStatus = PgStatus | "UNKNOWN";

interface FakeTransaction {
  clientReference: string;
  pgTransactionId: string;
  status: PgStatus;
  reason?: string;
}

interface ChargeResult {
  pgTransactionId: string;
  status: PgStatus;
  reason?: string;
}

interface InquiryResult {
  clientReference: string | null;
  pgTransactionId: string;
  status: InquiryStatus;
  reason?: string;
}

interface FakePgConfig {
  failureRate: number;
  timeoutRate: number;
  asyncRate: number;
  latencyMs: number;
}

const ASYNC_RESOLUTION_DELAY_MS = Number(process.env.ASYNC_RESOLUTION_DELAY_MS ?? 2000);
// payment-gateway 쪽 ForgeHttpClient 타임아웃(FAKE_PG_TIMEOUT_MS, 기본 3000ms)보다 확실히
// 길게 잡아서, 호출자가 항상 먼저 포기하도록 한다 — 그래야 "응답을 못 받은 타임아웃"을
// 실제로 재현할 수 있다.
const TIMEOUT_SIMULATION_DELAY_MS = Number(process.env.TIMEOUT_SIMULATION_DELAY_MS ?? 6000);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 실제 외부 PG를 흉내낸다 — 자체 DB 없이 인메모리로 거래를 들고 있는다(진짜 외부 시스템처럼
// payment-gateway와 상태를 공유하지 않는다는 걸 의도적으로 보여주기 위함). clientReference로
// 멱등성을 보장해서, payment-gateway의 ForgeHttpClient가 재시도해도(혹은 타임아웃 후 같은
// 참조로 재조회해도) 새로 처리하지 않고 이미 저장된 상태를 그대로 돌려준다 — 실제 PG들이
// 요구하는 멱등키 계약과 같은 전제다.
@Injectable()
export class FakePgService {
  private readonly logger = new Logger(FakePgService.name);
  private readonly transactions = new Map<string, FakeTransaction>();
  private readonly byPgId = new Map<string, string>();
  private config: FakePgConfig = { failureRate: 0, timeoutRate: 0, asyncRate: 0, latencyMs: 50 };

  constructor(@Inject(CALLBACK_HTTP_CLIENT) private readonly callbackClient: ForgeHttpClient) {}

  getConfig(): FakePgConfig {
    return { ...this.config };
  }

  setConfig(dto: FakePgConfigDto): FakePgConfig {
    this.config = { ...this.config, ...dto };
    this.logger.log(`flakiness 설정 변경 — ${JSON.stringify(this.config)}`);
    return this.getConfig();
  }

  async charge(clientReference: string, _amount: number): Promise<ChargeResult> {
    const existing = this.transactions.get(clientReference);
    if (existing) {
      // 이미 아는 거래 — 재요청(재시도든 진짜 중복이든)은 새로 굴리지 않고 그대로 반환한다.
      return { pgTransactionId: existing.pgTransactionId, status: existing.status, reason: existing.reason };
    }

    await delay(this.config.latencyMs);
    const pgTransactionId = randomUUID();
    const roll = Math.random();

    if (roll < this.config.timeoutRate) {
      // 응답을 못 받는 상황을 재현 — 호출자의 axios 타임아웃이 먼저 끊기지만, fake-pg
      // 내부적으로는 실제 PG처럼 계속 처리를 진행해서 나중에 조회 가능한 결과를 남긴다.
      this.store(clientReference, pgTransactionId, "PROCESSING");
      await delay(TIMEOUT_SIMULATION_DELAY_MS);
      const finalStatus: PgStatus = Math.random() > 0.15 ? "APPROVED" : "DECLINED";
      const reason = finalStatus === "DECLINED" ? "한도초과" : undefined;
      this.store(clientReference, pgTransactionId, finalStatus, reason);
      return { pgTransactionId, status: finalStatus, reason };
    }

    if (roll < this.config.timeoutRate + this.config.failureRate) {
      // 진짜 서버 오류 — 아무 것도 처리되지 않았으므로 저장하지 않는다(재시도가 새로 굴려도 됨).
      throw new HttpException("PG 내부 오류", 500);
    }

    if (roll < this.config.timeoutRate + this.config.failureRate + this.config.asyncRate) {
      this.store(clientReference, pgTransactionId, "PROCESSING");
      this.scheduleAsyncResolution(clientReference, pgTransactionId);
      return { pgTransactionId, status: "PROCESSING" };
    }

    const approved = Math.random() > 0.15;
    const status: PgStatus = approved ? "APPROVED" : "DECLINED";
    const reason = approved ? undefined : "한도초과";
    this.store(clientReference, pgTransactionId, status, reason);
    return { pgTransactionId, status, reason };
  }

  inquireByReference(clientReference: string): InquiryResult {
    const found = this.transactions.get(clientReference);
    if (!found) return { clientReference, pgTransactionId: "", status: "UNKNOWN" };
    return { clientReference, pgTransactionId: found.pgTransactionId, status: found.status, reason: found.reason };
  }

  inquireById(pgTransactionId: string): InquiryResult {
    const ref = this.byPgId.get(pgTransactionId);
    if (!ref) return { clientReference: null, pgTransactionId, status: "UNKNOWN" };
    const found = this.transactions.get(ref)!;
    return { clientReference: ref, pgTransactionId: found.pgTransactionId, status: found.status, reason: found.reason };
  }

  private store(clientReference: string, pgTransactionId: string, status: PgStatus, reason?: string): void {
    this.transactions.set(clientReference, { clientReference, pgTransactionId, status, reason });
    this.byPgId.set(pgTransactionId, clientReference);
  }

  private scheduleAsyncResolution(clientReference: string, pgTransactionId: string): void {
    setTimeout(async () => {
      const approved = Math.random() > 0.15;
      const status: PgStatus = approved ? "APPROVED" : "DECLINED";
      const reason = approved ? undefined : "한도초과(비동기)";
      this.store(clientReference, pgTransactionId, status, reason);
      try {
        await this.callbackClient.post("/webhooks/pg-callback", { clientReference, pgTransactionId, status, reason });
      } catch (err) {
        this.logger.warn(`콜백 전송 실패 — ${clientReference}: ${(err as Error).message}`);
      }
    }, ASYNC_RESOLUTION_DELAY_MS);
  }
}
