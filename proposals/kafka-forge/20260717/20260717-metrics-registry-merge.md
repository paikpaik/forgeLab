# kafka-forge 제안 — 기존 지표를 외부 Registry에도 등록할 수 있는 export 추가

## 계기

`services/live-ranking`의 aggregator는 node-forge `MetricsModule.forRoot()`가 자동 등록하는
`GET /metrics`와, kafka-forge의 `metricsRegistry`를 직접 노출하는 `GET /metrics/kafka`를
따로 만들어야 했다.

```ts
// node-forge 쪽 — MetricsModule.forRoot()가 이미 자동으로 등록
// GET /metrics → ForgeMetrics.registry만 직렬화

// kafka-forge 쪽 — 별도로 직접 만든 컨트롤러
@Get("metrics/kafka")
async metrics() {
  return metricsRegistry.metrics(); // kafka-forge 자체 registry만 직렬화
}
```

실제 운영이라면 Prometheus 스크래핑 타겟을 서비스당 하나로 묶고 싶을 텐데, 지금은 두 곳으로
쪼개서 노출할 수밖에 없다.

## 현재 한계

`src/metrics.ts`가 지표를 모듈 로드 시점에 자기 자신의 고정 싱글턴에만 등록한다.

```ts
export const metricsRegistry = new Registry();

export const producedTotal = new Counter({
  name: "kafka_forge_produced_total",
  // ...
  registers: [metricsRegistry], // 이 레지스트리에만 등록됨, 다른 곳에 추가할 통로가 없음
});
```

`metricsRegistry` 자체는 `index.ts`에서 export되지만, 그 레지스트리에 **어떤 지표들이
등록돼 있는지** 목록은 외부에 노출되지 않는다. 그래서 소비 서비스 쪽에서
`someOtherRegistry.registerMetric(...)`을 직접 호출해서 합치는 것도 불가능하다(합칠 대상
지표 객체를 알 방법이 없음).

## 제안

이미 생성된 지표들을 외부 Registry에도 등록해주는 함수를 하나 export한다.

```ts
// metrics.ts
export function registerMetricsInto(registry: Registry): void {
  [producedTotal, produceErrorsTotal, consumedTotal, consumeErrorsTotal,
   consumeDurationSeconds, consumerLag].forEach((metric) => registry.registerMetric(metric));
}
```

소비 서비스는 초기화 시 한 번만 호출하면 된다.

```ts
// 소비 서비스 쪽 (예: live-ranking aggregator)
import { registerMetricsInto } from "@paikpaik/kafka-forge";

registerMetricsInto(forgeMetrics.registry); // 이후 GET /metrics 하나에 둘 다 나옴
```

prom-client의 `Registry.registerMetric()`은 이미 만들어진 지표 객체를 "추가로" 다른
레지스트리에도 등록할 수 있게 해주므로, 기존 `metricsRegistry`로의 노출은 그대로 유지되면서
(하위 호환) 외부 레지스트리에도 같은 지표가 나타나게 된다.

## 검증 포인트

- `registerMetricsInto(externalRegistry)` 호출 후 `externalRegistry.metrics()` 결과에
  `kafka_forge_*` 지표가 포함되는지
- 호출 이후에도 기존 `metricsRegistry.metrics()`가 동일하게 동작하는지(하위 호환)
- `registerMetricsInto`를 호출하지 않으면 기존과 동작이 100% 동일한지(옵트인이라 기본
  동작 변화 없음)

## 기각한 대안

- **`StandardProducer`/`StandardConsumer` 생성자가 외부 `Registry`를 받아서 그때 지표를
  새로 생성**: 이러면 모듈 로드 시점에 이미 만들어진 싱글턴 지표와 인스턴스별 지표가
  이중으로 존재하게 되고, `metrics.ts`의 현재 구조(모듈 top-level 상수)를 크게 뜯어고쳐야
  해서 변경 범위가 크다. 이미 있는 지표 객체를 추가로 등록해주는 함수 하나가 훨씬 가볍다.
