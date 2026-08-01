import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { InjectDataSource } from "@paikpaik/node-forge/database/nestjs";
import type { DataSource } from "typeorm";
import { Brackets } from "typeorm";
import { DeliveryEntity } from "../entities/delivery.entity";
import { FIRST_ATTEMPT_FALLBACK_GRACE_MS, RETRY_POLL_INTERVAL_MS } from "../shared/constants";
import { DeliveryAttemptService } from "./delivery-attempt.service";

// Kafka는 "최초 시도"만 실시간으로 트리거한다 — 장시간(최대 6시간대) 백오프 재시도는 Kafka의
// 지연 발행 기능으로 못 하므로, 이 폴러가 nextAttemptAt이 지난 pending delivery를 직접
// 집어서 재시도한다. 두 번째 조건(nextAttemptAt IS NULL AND attempts=0 AND 일정 시간 경과)은
// dispatch outbox 발행이 실패했거나 Kafka 메시지가 유실된 경우의 안전망 — 이것마저 없으면
// 그 delivery는 영원히 시도조차 안 된 채로 pending에 멈춰있게 된다.
@Injectable()
export class RetryPollerService {
  private readonly logger = new Logger(RetryPollerService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly deliveryAttemptService: DeliveryAttemptService,
  ) {}

  @Interval(RETRY_POLL_INTERVAL_MS)
  async pollDue(): Promise<void> {
    try {
      const nowIso = new Date().toISOString();
      const graceThreshold = new Date(Date.now() - FIRST_ATTEMPT_FALLBACK_GRACE_MS);

      const due = await this.dataSource
        .getRepository(DeliveryEntity)
        .createQueryBuilder("d")
        .where("d.status = :status", { status: "pending" })
        .andWhere(
          new Brackets((qb) => {
            qb.where("d.nextAttemptAt IS NOT NULL AND d.nextAttemptAt <= :now", { now: nowIso }).orWhere(
              "d.nextAttemptAt IS NULL AND d.attempts = 0 AND d.createdAt <= :grace",
              { grace: graceThreshold },
            );
          }),
        )
        .limit(50)
        .getMany();

      for (const delivery of due) {
        await this.deliveryAttemptService.attempt(delivery.id);
      }
    } catch (err) {
      this.logger.error(`재시도 폴링 실패: ${(err as Error).message}`, (err as Error).stack);
    }
  }
}
