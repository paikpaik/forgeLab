import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@paikpaik/node-forge/database/nestjs";
import { IsNull, Not } from "typeorm";
import type { DataSource } from "typeorm";
import { DistributedCircuitBreaker } from "@paikpaik/node-forge/redis";
import type { ForgeHttpClient } from "@paikpaik/node-forge/http";
import { ForgeBizError, ForgeError } from "@paikpaik/node-forge/core";
import { AdminEventBus } from "@paikpaik/node-forge/events";
import { ADMIN_EVENT_BUS } from "@paikpaik/node-forge/events/nestjs";
import { PaymentTransactionEntity } from "./entities/payment-transaction.entity";
import { PaymentAttemptEntity } from "./entities/payment-attempt.entity";
import type { CreatePaymentDto } from "./dto/create-payment.dto";
import type { PgCallbackDto } from "./dto/pg-callback.dto";
import { PG_HTTP_CLIENT } from "./app.constants";
import { PG_CIRCUIT_KEY, MAX_RECONCILE_ATTEMPTS } from "../shared/constants";
import type { PaymentStatus, PaymentAttemptOutcome } from "../shared/constants";
import type { AdminLogEvent } from "../shared/admin-log-event";

interface PgChargeResponse {
  pgTransactionId: string;
  status: "APPROVED" | "DECLINED" | "PROCESSING";
  reason?: string;
}

interface PgInquiryResponse {
  clientReference: string | null;
  pgTransactionId: string;
  status: "APPROVED" | "DECLINED" | "PROCESSING" | "UNKNOWN";
  reason?: string;
}

export interface PaymentViewV1 {
  id: string;
  status: PaymentStatus;
}

export interface PaymentViewV2 extends PaymentViewV1 {
  merchantId: string;
  amount: number;
  pgTransactionId: string | null;
  reconcileAttempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

function toV2(p: PaymentTransactionEntity): PaymentViewV2 {
  return {
    id: p.id,
    status: p.status,
    merchantId: p.merchantId,
    amount: p.amount,
    pgTransactionId: p.pgTransactionId,
    reconcileAttempts: p.reconcileAttempts,
    lastError: p.lastError,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function toView(p: PaymentTransactionEntity, apiVersion: "v1" | "v2"): PaymentViewV1 | PaymentViewV2 {
  const v2 = toV2(p);
  return apiVersion === "v1" ? { id: v2.id, status: v2.status } : v2;
}

@Injectable()
export class PaymentService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly circuitBreaker: DistributedCircuitBreaker,
    @Inject(PG_HTTP_CLIENT) private readonly pgClient: ForgeHttpClient,
    @Inject(ADMIN_EVENT_BUS) private readonly adminEvents: AdminEventBus<AdminLogEvent>,
  ) {}

  // 멱등성 dedupe — 같은 idempotencyKey로 재요청하면 새 결제를 만들지 않고 기존 결제의
  // 현재 상태를 그대로 반환한다(가맹점이 네트워크 재시도를 하는 경우를 대비).
  async createPayment(dto: CreatePaymentDto, apiVersion: "v1" | "v2"): Promise<PaymentViewV1 | PaymentViewV2> {
    const repo = this.dataSource.getRepository(PaymentTransactionEntity);
    const idempotencyKey = dto.idempotencyKey ?? randomUUID();

    const existing = await repo.findOneBy({ idempotencyKey });
    if (existing) return toView(existing, apiVersion);

    const payment = await repo.save({
      id: randomUUID(),
      merchantId: dto.merchantId,
      idempotencyKey,
      clientReference: randomUUID(),
      amount: dto.amount,
      apiVersion,
      status: "PENDING" as PaymentStatus,
      pgTransactionId: null,
      reconcileAttempts: 0,
      lastError: null,
    });

    await this.attemptCharge(payment);

    const updated = await repo.findOneBy({ id: payment.id });
    return toView(updated!, apiVersion);
  }

  async getPayment(id: string, apiVersion: "v1" | "v2"): Promise<PaymentViewV1 | PaymentViewV2> {
    const payment = await this.dataSource.getRepository(PaymentTransactionEntity).findOneBy({ id });
    if (!payment) throw new ForgeBizError("E9404", "결제를 찾을 수 없습니다");
    return toView(payment, apiVersion);
  }

  async listAttempts(paymentId: string): Promise<PaymentAttemptEntity[]> {
    return this.dataSource.getRepository(PaymentAttemptEntity).find({
      where: { paymentId },
      order: { attemptNo: "ASC" },
    });
  }

  async listDead(): Promise<PaymentTransactionEntity[]> {
    return this.dataSource.getRepository(PaymentTransactionEntity).find({
      where: { status: "DEAD" },
      order: { updatedAt: "DESC" },
      take: 20,
    });
  }

  // 이 실험의 핵심 — 회로가 이미 OPEN이면 PG를 호출조차 안 하므로 그 자리에서 바로
  // FAILED(모호함 없음). 실제로 호출했는데 응답 자체를 못 받았을 때(타임아웃/커넥션 에러)만
  // IN_DOUBT로 남겨서 reconciler가 나중에 거래조회로 해소하게 한다.
  private async attemptCharge(payment: PaymentTransactionEntity): Promise<void> {
    const repo = this.dataSource.getRepository(PaymentTransactionEntity);
    const attemptNo = (await this.dataSource.getRepository(PaymentAttemptEntity).count({ where: { paymentId: payment.id } })) + 1;
    const start = Date.now();

    try {
      const result = await this.circuitBreaker.execute(PG_CIRCUIT_KEY, () =>
        this.pgClient.post<PgChargeResponse>("/pg/charge", {
          clientReference: payment.clientReference,
          amount: payment.amount,
        }),
      );
      const durationMs = Date.now() - start;

      if (result.status === "APPROVED") {
        await repo.update(payment.id, { status: "CONFIRMED", pgTransactionId: result.pgTransactionId, lastError: null });
        await this.recordAttempt(payment.id, attemptNo, "SUCCESS", 200, durationMs, null);
        this.adminEvents.emit({ message: `결제 승인 — ${payment.merchantId} ${payment.amount}원`, at: new Date().toISOString() });
      } else if (result.status === "DECLINED") {
        const reason = result.reason ?? "거절됨";
        await repo.update(payment.id, { status: "FAILED", pgTransactionId: result.pgTransactionId, lastError: reason });
        await this.recordAttempt(payment.id, attemptNo, "DECLINED", 200, durationMs, reason);
        this.adminEvents.emit({ message: `결제 거절 — ${payment.merchantId} (${reason})`, at: new Date().toISOString() });
      } else {
        // PROCESSING — PG가 비동기로 접수했다. 웹훅 콜백이 올 때까지 PENDING을 유지한다.
        await repo.update(payment.id, { pgTransactionId: result.pgTransactionId });
        await this.recordAttempt(payment.id, attemptNo, "SUCCESS", 202, durationMs, "비동기 접수 — 콜백 대기");
      }
    } catch (err) {
      const durationMs = Date.now() - start;

      if (err instanceof ForgeError && err.code === "E9502") {
        await repo.update(payment.id, { status: "FAILED", lastError: "일시적으로 결제가 지연되고 있습니다(회로 차단)" });
        await this.recordAttempt(payment.id, attemptNo, "CIRCUIT_OPEN", null, durationMs, null);
        this.adminEvents.emit({ message: `회로 OPEN — PG 호출 생략, 즉시 실패 처리(${payment.merchantId})`, at: new Date().toISOString() });
        return;
      }

      const axiosErr = err as { response?: { status: number }; message?: string };
      if (axiosErr.response) {
        // PG가 명시적으로 에러를 응답 — 확정 정보이므로 FAILED(모호하지 않음).
        await repo.update(payment.id, { status: "FAILED", lastError: `PG 오류(HTTP ${axiosErr.response.status})` });
        await this.recordAttempt(payment.id, attemptNo, "PG_ERROR", axiosErr.response.status, durationMs, null);
        return;
      }

      // 응답 자체를 못 받음(타임아웃/커넥션 에러) — PG가 실제로 처리했는지 모르므로 IN_DOUBT.
      await repo.update(payment.id, { status: "IN_DOUBT", lastError: axiosErr.message ?? "응답 없음" });
      await this.recordAttempt(payment.id, attemptNo, "TIMEOUT", null, durationMs, null);
      this.adminEvents.emit({ message: `PG 응답 없음 — IN_DOUBT 처리, 거래조회 대기(${payment.merchantId})`, at: new Date().toISOString() });
    }
  }

  // fake-pg가 비동기(202) 거래의 최종 결과를 알려줄 때 호출한다. clientReference로 조회하고,
  // 이미 최종 상태로 처리됐으면(중복 콜백) 조용히 무시한다 — 웹훅은 중복 전달될 수 있다는
  // 전제를 항상 깔고 멱등하게 처리해야 한다.
  async handleWebhookCallback(dto: PgCallbackDto): Promise<{ handled: boolean }> {
    const repo = this.dataSource.getRepository(PaymentTransactionEntity);
    const payment = await repo.findOneBy({ clientReference: dto.clientReference });
    if (!payment || payment.status !== "PENDING") return { handled: false };

    const finalStatus: PaymentStatus = dto.status === "APPROVED" ? "CONFIRMED" : "FAILED";
    await repo.update(payment.id, {
      status: finalStatus,
      pgTransactionId: dto.pgTransactionId ?? payment.pgTransactionId,
      lastError: dto.status === "APPROVED" ? null : (dto.reason ?? "거절됨"),
    });

    const attemptNo = (await this.dataSource.getRepository(PaymentAttemptEntity).count({ where: { paymentId: payment.id } })) + 1;
    await this.recordAttempt(
      payment.id,
      attemptNo,
      dto.status === "APPROVED" ? "WEBHOOK_CONFIRMED" : "WEBHOOK_FAILED",
      null,
      null,
      "비동기 웹훅 콜백",
    );
    this.adminEvents.emit({ message: `웹훅 콜백 수신 — ${payment.merchantId} ${finalStatus}`, at: new Date().toISOString() });
    return { handled: true };
  }

  // IN_DOUBT(응답 자체를 못 받음) 거래와, PENDING인데 pgTransactionId가 이미 찍힌 거래(PG가
  // "처리 중"이라고는 답했지만 웹훅이 온다는 보장이 없는 경우 — 예: 재시도가 원래 요청의
  // "아직 처리 중" 응답을 대신 받아버린 케이스, 실제 Docker 검증 중 재현됨)를 거래조회
  // (idempotent GET)로 해소한다. PaymentReconcilerService(@Interval)와
  // "/admin/payments/:id/reconcile" 수동 트리거가 둘 다 이 메서드를 공유한다.
  async reconcile(paymentId: string): Promise<boolean> {
    const repo = this.dataSource.getRepository(PaymentTransactionEntity);
    const payment = await repo.findOneBy({ id: paymentId });
    if (!payment) return false;
    const reconcilable = payment.status === "IN_DOUBT" || (payment.status === "PENDING" && payment.pgTransactionId !== null);
    if (!reconcilable) return false;

    const result = await this.pgClient.get<PgInquiryResponse>(`/pg/charge/by-reference/${payment.clientReference}`);

    if (result.status === "APPROVED" || result.status === "DECLINED") {
      const finalStatus: PaymentStatus = result.status === "APPROVED" ? "CONFIRMED" : "FAILED";
      await repo.update(payment.id, {
        status: finalStatus,
        pgTransactionId: result.pgTransactionId || payment.pgTransactionId,
        lastError: result.status === "APPROVED" ? null : (result.reason ?? "거절됨"),
      });
      const attemptNo = (await this.dataSource.getRepository(PaymentAttemptEntity).count({ where: { paymentId: payment.id } })) + 1;
      await this.recordAttempt(payment.id, attemptNo, "RECONCILED", null, null, `거래조회로 해소 — ${result.status}`);
      this.adminEvents.emit({ message: `거래조회로 해소 — ${payment.merchantId} ${finalStatus}`, at: new Date().toISOString() });
      return true;
    }

    // 아직 PROCESSING이거나 PG도 모르는 거래(UNKNOWN) — 재시도 카운터만 올린다.
    const attempts = payment.reconcileAttempts + 1;
    if (attempts >= MAX_RECONCILE_ATTEMPTS) {
      await repo.update(payment.id, { status: "DEAD", reconcileAttempts: attempts });
      this.adminEvents.emit({ message: `거래조회 포기 — ${payment.merchantId} DEAD 처리(운영자 확인 필요)`, at: new Date().toISOString() });
    } else {
      await repo.update(payment.id, { reconcileAttempts: attempts });
    }
    return false;
  }

  // reconcile()이 처리할 수 있는 두 상태(IN_DOUBT, pgTransactionId가 있는 PENDING)를 모두
  // 모은다 — PaymentReconcilerService의 @Interval이 이 목록을 그대로 순회한다.
  async listInDoubt(): Promise<PaymentTransactionEntity[]> {
    return this.dataSource.getRepository(PaymentTransactionEntity).find({
      where: [{ status: "IN_DOUBT" }, { status: "PENDING", pgTransactionId: Not(IsNull()) }],
    });
  }

  // panel.html의 테스트 도구가 fake-pg의 flakiness를 조절할 때 쓰는 프록시 — 브라우저가
  // fake-pg 포트를 몰라도 되게(같은 origin, CORS 이슈 없음) app이 대신 호출해준다.
  async proxyGetFakePgConfig(): Promise<unknown> {
    return this.pgClient.get("/admin/fake-pg/config");
  }

  async proxySetFakePgConfig(config: unknown): Promise<unknown> {
    return this.pgClient.post("/admin/fake-pg/config", config);
  }

  private async recordAttempt(
    paymentId: string,
    attemptNo: number,
    outcome: PaymentAttemptOutcome,
    httpStatus: number | null,
    durationMs: number | null,
    detail: string | null,
  ): Promise<void> {
    await this.dataSource.getRepository(PaymentAttemptEntity).save({
      id: randomUUID(),
      paymentId,
      attemptNo,
      outcome,
      httpStatus,
      durationMs,
      detail,
    });
  }
}
