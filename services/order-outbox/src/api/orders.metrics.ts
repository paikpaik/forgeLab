import { Inject, Injectable } from "@nestjs/common";
import { METRICS_INSTANCE } from "@paikpaik/node-forge/metrics/nestjs";
import type { ForgeMetrics } from "@paikpaik/node-forge/metrics";
import type { Counter } from "prom-client";

@Injectable()
export class OrdersMetrics {
  readonly ordersCreatedTotal: Counter<string>;

  constructor(@Inject(METRICS_INSTANCE) metrics: ForgeMetrics) {
    this.ordersCreatedTotal = metrics.counter({
      name: "order_outbox_orders_created_total",
      help: "DB 트랜잭션으로 생성된(주문+outbox row) 주문 수",
    });
  }
}
