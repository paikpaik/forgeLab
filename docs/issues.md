# forge 패키지 이슈 대응 이력

forge-lab에서 `@paikpaik/node-forge`, `@paikpaik/kafka-forge`를 실 소비자로 검증하다가 발견한 문제와,
그게 어느 버전에서 어떻게 반영됐는지 정리한다. 발견 → `proposals/<패키지>/`에 제안서 작성 →
사용자가 해당 forge 레포에서 직접 수정/배포하는 흐름을 따른다 (forge-lab이 forge 소스를
직접 고치지 않는다는 원칙, `.claude/rules/common/principles.md` 참고).

## @paikpaik/node-forge

| 버전 | 심각도 | 이슈 | 대응 |
|---|---|---|---|
| 1.0.4 | LOW (성능) | `HealthChecker`가 `/health` 호출마다 그대로 재실행돼서, Kafka Admin처럼 연결 자체가 무거운 체커는 호출마다 새 연결을 열고 닫는 비용이 반복됨 | `checkHealth`/`HealthModule.forRootAsync`에 `cacheMs` 옵션 추가 — 지정 시간 안의 반복 호출은 마지막 결과를 재사용. 생략하면 기존과 동일(하위 호환) |
| 1.0.4 | LOW (기능 gap) | Redis List에 `lpush`/`lrange`/`llen`은 있는데 `ltrim`이 없어서 "최근 N개만 유지" 패턴을 완전히 구현할 수 없었음(리스트가 무한히 자람) | `ltrim(key, start, stop)` 추가 |
| 1.0.3 | MEDIUM (기능 gap) | `zadd`가 `entries`만 받고 NX/XX 옵션이 없어서, "동시에 같은 member로 요청이 와도 딱 한 번만 등록"이 안 됨 — `zscore` 조회 후 `zadd`로 나누면 그 사이에 레이스 컨디션(TOCTOU) 발생 | `zadd(key, entries, { mode: "NX" \| "XX", ch? })` 옵션 추가. waiting-room의 중복 등록 방지를 `getClient()` 우회 없이 wrapped API로 구현 가능해짐 |
| 1.0.2 | HIGH | tsup `splitting: false`로 엔트리마다(`core/index.js`, `response/nestjs/index.js` 등) `ForgeBizError` 클래스가 각각 따로 번들링되어, `ForgeExceptionFilter`의 `instanceof` 매칭이 실패 → 에러가 잡히지 않고 500으로 떨어짐 | `splitting: true`로 변경, 공유 청크로 클래스 단일화. `npm pack` 기반 스모크 테스트를 CI에 추가 |
| 1.0.1 | HIGH | `package.json`의 `exports` 맵 전체(`.`, `./core`, `./response/nestjs` 등)가 `require` 조건에서 존재하지 않는 `.cjs` 파일을 가리켜, `require()`로는 어떤 서브패스도 로드 불가 | `require`는 실제 산출물(`.js`), `import`는 `.mjs`를 가리키도록 exports 맵 전면 수정 |
| 1.0.1 | MEDIUM | `ResponseInterceptor`(성공 응답 `ok()` 래핑)는 있는데 짝이 되는 에러 필터가 없어서, 서비스마다 `ForgeBizError`→`fail()` 변환을 직접 구현해야 했음 | `response/nestjs`에 `ForgeExceptionFilter` 추가 (`HttpAdapterHost` 사용, Express/Fastify 어댑터 모두 지원) |
| 1.0.1 | MEDIUM | `HealthModule.forRoot()`가 체커를 모듈 정의 시점에 동기적으로 받아서, `RedisModule`이 DI로 만든 `ForgeRedisClient` 인스턴스를 헬스체커가 재사용할 방법이 없었음 | `RedisModule`/`LoggerModule`과 동일한 `useFactory`/`inject` 패턴으로 `HealthModule.forRootAsync` 추가 |
| 1.0.5 | MEDIUM (기능 gap) | gRPC 클라이언트를 쓰는 서비스가 다중 인스턴스로 스케일될 때, grpc-js 기본 LB 정책(`pick_first`)이 최초 연결한 인스턴스에 고정돼서 나머지 인스턴스가 트래픽을 못 받음(조용히 실패, 에러 없음) — msa-checkout에서 `docker stats` NET I/O 실측으로 재현·검증 | `grpc` 모듈 신설(`buildGrpcClientChannelOptions`/`createGrpcClientOptions` 등) — `dns:///` 스킴 + `round_robin` LB가 기본값 |
| 1.0.5 | MEDIUM (기능 gap) | bearer 토큰 인증이 필요한 서비스마다 HMAC/JWT를 직접 구현해야 했음(waiting-room, msa-checkout이 구조적으로 동일한 코드를 두 번 작성) | `auth` 모듈 신설(`signToken`/`verifyToken`, `auth/nestjs`의 `JwtAuthModule`/`JwtAuthGuard`/`RolesGuard`/`Roles`) — Account 영속화나 refresh-token 등은 스코프 제외, 발급/검증/가드까지만 |
| 1.0.6 | HIGH | 1.0.5에서 막 추가된 `auth/nestjs`의 `RolesGuard`가 생성자의 `Reflector` 타입 추론에만 의존(파라미터 데코레이터 없음)하는데, tsup(esbuild) 빌드가 `emitDecoratorMetadata`의 `design:paramtypes`를 방출하지 않아 실제 배포된 `dist`에서는 `Reflector`가 `undefined`로 주입됨 — `@Roles()`가 붙은 모든 라우트가 500. 소스 레벨 테스트로는 못 잡고 실제 설치해서 실행해야만 드러남 | `constructor(@Inject(Reflector) private readonly reflector: Reflector)`로 파라미터 데코레이터 명시. 같은 원인의 버그가 있던 `EventsExplorer`(discovery/scanner/reflector)도 함께 발견해 동일하게 수정. 스모크 테스트에 `self:paramtypes` 메타데이터 검증 + `EventsModule` 실제 부팅 테스트를 추가해 이런 종류의 버그를 CI에서 재발 방지 |
| 1.0.7 | MEDIUM (기능 gap) | NestJS 쪽에는 요청 단위 trace ID 전파/access log 기능이 없어서(fastify에는 이미 있었음) 소비 서비스가 매번 직접 구현해야 했음 — msa-checkout에서 로컬로 구현·검증한 뒤 제안 | `core`에 `runWithRequestContext`/`getRequestContext`(AsyncLocalStorage 래퍼) 신설, `logger/nestjs`에 `TraceAccessLogMiddleware`, `grpc/nestjs`에 `buildOutgoingTraceMetadata`/`GrpcTraceAccessLogInterceptor` 추가. 크로스 엔트리 DI(1.0.2류 버그) 재발을 막기 위해 실제 앱 부팅까지 하는 스모크 테스트 포함 |
| 1.0.8 | MEDIUM (데이터 정합성) | 1.0.7에서 막 추가된 trace 발급 로직이 새 trace를 시작할 때 `crypto.randomUUID()`를 하이픈 그대로 써서, trace를 새로 연 프로세스 자신의 로그(하이픈 포함)와 그걸 전파받은 하위 프로세스의 로그(`buildTraceparent`가 정규화한 하이픈 없는 32-hex)가 값은 같은데 문자열이 달라 "traceId로 정확 일치 grep"이 깨짐 — msa-checkout에서 gateway/orchestrator 로그를 실제로 비교해 재현 | `core`에 `generateTraceId()`(32-char hex를 하이픈 없이 직접 발급) 헬퍼 신설, `logger/nestjs`/`grpc/nestjs`/`logger/fastify`(1.0.7 이전부터 있던 코드까지) 세 곳 전부 `crypto.randomUUID()` → `generateTraceId()`로 교체 |
| 1.0.9 | MEDIUM (기능 gap) | 프로세스 내부 이벤트를 폴링 없이 실시간으로 구독하게 해주는 기능이 없어서, order-outbox가 "생성→발행→확인" 3단계를 SSE로 실시간 스트리밍하려면 매 서비스가 rxjs `Subject` 브로드캐스터 + `@Sse()` 컨트롤러를 직접 구현해야 했음(도메인 로직과 무관한 순수 보일러플레이트) — order-outbox에서 로컬로 구현·Docker 검증한 뒤 제안 | `events` 모듈에 `AdminEventBus<T>`(rxjs `Subject` 기반 멀티캐스트 버스), `events/nestjs`에 `AdminEventsModule.forRoot({ path })`(`ADMIN_EVENT_BUS` 토큰 등록 + `<path>/stream` SSE 컨트롤러를 동적 생성) 추가. `@Controller(path)`를 클래스 선언이 아니라 함수 호출로 동적 적용하는 새 패턴이라, esbuild(tsup) 번들 dist에서도 데코레이터 메타데이터가 살아있는지(1.0.6 RolesGuard류 버그 재발 방지) 자체 smoke-test로 미리 검증해둠 |

## @paikpaik/kafka-forge

| 버전 | 심각도 | 이슈 | 대응 |
|---|---|---|---|
| 1.0.2 | LOW (관측성 gap) | `IdempotencyStore`로 걸러낸 메시지 수를 재는 자체 지표(`kafka_forge_*`)가 없어서, 소비 서비스마다 각자 다른 이름/라벨로 직접 재야 했음 — 여러 서비스를 한 대시보드에서 비교하기 어려움 | `StandardConsumer`가 dedup으로 스킵될 때 `kafka_forge_deduped_total{topic,group}`을 자체적으로 증가시키도록 추가 |
| 1.0.2 | LOW (관측성 gap) | 자체 지표(`producedTotal` 등)가 모듈 로드 시점에 고정 싱글턴 `metricsRegistry`에만 등록돼서, 소비 서비스가 자기 Registry(예: node-forge `ForgeMetrics.registry`)와 합쳐 하나의 `/metrics`로 노출할 방법이 없었음 — 서비스마다 `/metrics`와 `/metrics/kafka`를 따로 노출해야 했음 | `registerMetricsInto(registry)` export 추가 — 이미 만들어진 지표를 외부 Registry에도 등록. 하위 호환 유지(기존 `metricsRegistry` 노출은 그대로) |
| 1.0.3 | HIGH (데이터 정합성) | `StandardConsumer.processMessage()`가 "체크 → 이펙트 적용 → 마킹(사후)" 순서라서, 이펙트 적용 후 마킹 전에 컨슈머가 죽거나(크래시) 컨슈머 그룹 리밸런스로 파티션을 빼앗기면, 재배달 시 `wasProcessed`가 여전히 false라서 이펙트가 중복 적용됨 — `IdempotencyStore`가 막아야 하는 정확히 그 상황에서 못 막음 | `IdempotencyStore`에 선택적 `claim(key)` 추가 — 있으면 핸들러 실행 **전**에 원자적으로 선점하고, 사후 `markProcessed` 호출은 스킵. `claim`을 구현하지 않은 기존 저장소는 이전 동작 그대로(하위 호환) |
| 1.0.4 | HIGH (데이터 정합성) | `claim`이 성공/실패를 구분하지 못해서, 재시도까지 다 실패해 DLQ로 간(한 번도 성공한 적 없는) 메시지도 영구히 선점된 상태로 남음 — 버그를 고치고 같은 메시지를 재발행해도 "이미 처리됨"으로 조용히 스킵되어, DLQ 재처리라는 가장 흔한 운영 패턴이 막힘 | `IdempotencyStore`에 선택적 `release(key)` 추가 — `claim`으로 선점했지만 재시도 소진 후 DLQ로 이동하면 `StandardConsumer`가 자동으로 `release`를 호출해 선점을 되돌림. 성공한 메시지는 `release`가 호출되지 않아 크래시 윈도우 보호는 그대로 유지 |
| 1.0.4 | LOW (관측성/문서화) | `kafka_forge_consumed_total`이 이름만 보면 "성공 처리량"으로 읽히지만 실제로는 "성공+DLQ 이동 포함 시도 총량"이라 헷갈림 | `help` 문구 명확화 + 순수 성공 건수만 세는 `kafka_forge_handled_total` 신규 지표 추가 |
| 1.0.4 | LOW (기능 gap/편의성) | `toDlqTopicName()`이 만드는 `<topic>.dlq`가 kafka-forge 자신의 토픽 네이밍 컨벤션을 어겨서, DLQ 토픽에 대한 `EventContract`를 `defineEvent()`로 만들 수 없었음(직접 리터럴로 우회 필요) | 원본 `EventContract`로부터 DLQ용 contract(envelope 스키마 자동 생성 포함)를 만들어주는 `defineDlqEvent()` 헬퍼 추가 |
| 1.0.5 | HIGH (데이터 정합성) | `OutboxPublisher.publishPending()`이 배치 중 한 건이라도 실패하면 그 즉시 예외를 던져서, (a) 그 이전에 이미 성공한 row들도 `markPublished`가 호출되지 않아 다음 폴링에서 중복 발행되고 (b) 실패한 row 뒤에 있는 정상 row들은 영구히 발행 기회를 못 얻음(head-of-line blocking) — 정상/독성 row를 순서대로 DB에 직접 삽입해 실제로 재현: 정상 row가 5초마다 중복 발행(`produced_total` +5/40초), 독성 row는 무한 재시도, 세 번째 row는 테스트 기간 내내 미발행 | 배치 루프가 개별 row 실패에 더 이상 `throw`하지 않고 로그만 남긴 채 다음 row로 진행, 이미 성공한 건은 항상 `markPublished` 호출 |
| 1.0.5 | MEDIUM (기능 gap) | 발행이 계속 실패하는 row(예: 잘못된 topic)를 저장소가 스스로 "죽었다"고 표시하고 제외할 방법이 없어서, 위 부분 실패 버그를 고쳐도 독성 row가 매 폴링마다 영원히 재시도됨 | `OutboxStore`에 선택적 `markFailed?(id, error): Promise<void>` 훅 추가. `maxAttempts`/"죽음"의 정의는 kafka-forge가 갖지 않고 구현체(저장소) 책임으로 남김 — `IdempotencyStore.claim`/`release`와 동일한 저장소-정책 분리 원칙 |

live-ranking(2번째 실험)에서 처음 kafka-forge를 실 소비자로 붙이며 발견 → 제안 → 반영까지
확인. order-outbox(3번째 실험)에서 `OutboxPublisher`/`OutboxStore`를 실 소비자로 붙이며 위
1.0.5 이슈 2건을 추가로 발견 → 제안 → 반영까지 확인. 그 외 producer/consumer/재시도/DLQ/
IdempotencyStore 인터페이스는 갭 없이 그대로 사용 가능했음.

msa-checkout(4번째 실험)이 처음으로 node-forge에 `grpc`/`auth` 신규 모듈을 요청 → 1.0.5로
반영 확인. 반영된 `auth/nestjs`의 `RolesGuard`에서 새 버그(실제 배포 `dist`에서 `Reflector`
DI 실패)를 발견해 제안서 작성 → 1.0.6으로 즉시 수정 반영까지 확인(로컬 서브클래싱 우회 코드는
반영 즉시 제거하고 원래대로 되돌림). 이어서 API 게이트웨이 5대 책임 감사 중 관측(trace
전파) 요구가 생겨 로컬로 구현·검증한 뒤 제안 → 1.0.7로 반영 확인. 반영된 trace 발급 로직에서
새 버그(새로 발급하는 traceId가 하이픈 포함 UUID라 전파된 값과 문자열 표현이 어긋남)를
추가로 발견해 제안서 작성 → 1.0.8로 하루 만에 수정 반영까지 확인. 실제로 gateway/orchestrator
로그의 traceId가 문자열까지 정확히 일치하는 것을 `grep -c`로 재검증했다.

order-outbox가 `dashboard-panel-expansion`(대시보드/패널 공통 UX 확장) 3단계로 SSE 로그
스트리밍을 로컬 구현·검증한 뒤 제안 → 1.0.9로 반영 확인. api(생성/발행 이벤트)와
fulfillment(확인 이벤트, 별도 프로세스) 양쪽에서 공식 `AdminEventsModule`로 교체해
실시간 스트리밍이 정상 동작하는 걸 재검증했다.

---

이 문서는 `dashboard`의 **Issue** 탭에서 그대로 렌더링된다. 새로운 forge 이슈를 발견하면
`proposals/<패키지>/`에 제안서를 먼저 쓰고, 실제로 반영/배포되면 이 표에 한 줄 추가한다.
