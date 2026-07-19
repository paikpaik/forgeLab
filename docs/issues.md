# forge 패키지 이슈 대응 이력

forge-lab에서 `@paikpaik/node-forge`, `@paikpaik/kafka-forge`를 실 소비자로 검증하다가 발견한 문제와,
그게 어느 버전에서 어떻게 반영됐는지 정리한다. 발견 → `proposals/<패키지>/`에 제안서 작성 →
사용자가 해당 forge 레포에서 직접 수정/배포하는 흐름을 따른다 (forge-lab이 forge 소스를
직접 고치지 않는다는 원칙, `.claude/rules/common/principles.md` 참고).

## @paikpaik/node-forge

| 버전 | 심각도 | 이슈 | 대응 |
|---|---|---|---|
| 1.0.3 | MEDIUM (기능 gap) | `zadd`가 `entries`만 받고 NX/XX 옵션이 없어서, "동시에 같은 member로 요청이 와도 딱 한 번만 등록"이 안 됨 — `zscore` 조회 후 `zadd`로 나누면 그 사이에 레이스 컨디션(TOCTOU) 발생 | `zadd(key, entries, { mode: "NX" \| "XX", ch? })` 옵션 추가. waiting-room의 중복 등록 방지를 `getClient()` 우회 없이 wrapped API로 구현 가능해짐 |
| 1.0.2 | HIGH | tsup `splitting: false`로 엔트리마다(`core/index.js`, `response/nestjs/index.js` 등) `ForgeBizError` 클래스가 각각 따로 번들링되어, `ForgeExceptionFilter`의 `instanceof` 매칭이 실패 → 에러가 잡히지 않고 500으로 떨어짐 | `splitting: true`로 변경, 공유 청크로 클래스 단일화. `npm pack` 기반 스모크 테스트를 CI에 추가 |
| 1.0.1 | HIGH | `package.json`의 `exports` 맵 전체(`.`, `./core`, `./response/nestjs` 등)가 `require` 조건에서 존재하지 않는 `.cjs` 파일을 가리켜, `require()`로는 어떤 서브패스도 로드 불가 | `require`는 실제 산출물(`.js`), `import`는 `.mjs`를 가리키도록 exports 맵 전면 수정 |
| 1.0.1 | MEDIUM | `ResponseInterceptor`(성공 응답 `ok()` 래핑)는 있는데 짝이 되는 에러 필터가 없어서, 서비스마다 `ForgeBizError`→`fail()` 변환을 직접 구현해야 했음 | `response/nestjs`에 `ForgeExceptionFilter` 추가 (`HttpAdapterHost` 사용, Express/Fastify 어댑터 모두 지원) |
| 1.0.1 | MEDIUM | `HealthModule.forRoot()`가 체커를 모듈 정의 시점에 동기적으로 받아서, `RedisModule`이 DI로 만든 `ForgeRedisClient` 인스턴스를 헬스체커가 재사용할 방법이 없었음 | `RedisModule`/`LoggerModule`과 동일한 `useFactory`/`inject` 패턴으로 `HealthModule.forRootAsync` 추가 |

## @paikpaik/kafka-forge

| 버전 | 심각도 | 이슈 | 대응 |
|---|---|---|---|
| 1.0.2 | LOW (관측성 gap) | `IdempotencyStore`로 걸러낸 메시지 수를 재는 자체 지표(`kafka_forge_*`)가 없어서, 소비 서비스마다 각자 다른 이름/라벨로 직접 재야 했음 — 여러 서비스를 한 대시보드에서 비교하기 어려움 | `StandardConsumer`가 dedup으로 스킵될 때 `kafka_forge_deduped_total{topic,group}`을 자체적으로 증가시키도록 추가 |
| 1.0.2 | LOW (관측성 gap) | 자체 지표(`producedTotal` 등)가 모듈 로드 시점에 고정 싱글턴 `metricsRegistry`에만 등록돼서, 소비 서비스가 자기 Registry(예: node-forge `ForgeMetrics.registry`)와 합쳐 하나의 `/metrics`로 노출할 방법이 없었음 — 서비스마다 `/metrics`와 `/metrics/kafka`를 따로 노출해야 했음 | `registerMetricsInto(registry)` export 추가 — 이미 만들어진 지표를 외부 Registry에도 등록. 하위 호환 유지(기존 `metricsRegistry` 노출은 그대로) |
| 1.0.3 | HIGH (데이터 정합성) | `StandardConsumer.processMessage()`가 "체크 → 이펙트 적용 → 마킹(사후)" 순서라서, 이펙트 적용 후 마킹 전에 컨슈머가 죽거나(크래시) 컨슈머 그룹 리밸런스로 파티션을 빼앗기면, 재배달 시 `wasProcessed`가 여전히 false라서 이펙트가 중복 적용됨 — `IdempotencyStore`가 막아야 하는 정확히 그 상황에서 못 막음 | `IdempotencyStore`에 선택적 `claim(key)` 추가 — 있으면 핸들러 실행 **전**에 원자적으로 선점하고, 사후 `markProcessed` 호출은 스킵. `claim`을 구현하지 않은 기존 저장소는 이전 동작 그대로(하위 호환) |

live-ranking(2번째 실험)에서 처음 kafka-forge를 실 소비자로 붙이며 위 세 건을 발견 → 제안 →
반영까지 확인. 그 외 producer/consumer/재시도/DLQ/IdempotencyStore 인터페이스는 갭 없이
그대로 사용 가능했음.

---

이 문서는 `dashboard`의 **Issue** 탭에서 그대로 렌더링된다. 새로운 forge 이슈를 발견하면
`proposals/<패키지>/`에 제안서를 먼저 쓰고, 실제로 반영/배포되면 이 표에 한 줄 추가한다.
