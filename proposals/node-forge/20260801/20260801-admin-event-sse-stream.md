# node-forge 제안 — 프로세스 내부 이벤트를 SSE로 실시간 스트리밍하는 공통 모듈

## 계기

`dashboard-panel-expansion` 플랜의 3단계(관측 — 실시간 데이터 흐름 확인)로, `order-outbox`
실험에 "생성 → 발행 → 확인" 3단계 전이를 폴링 없이 실시간으로 패널에 보여주는 SSE 스트림을
로컬로 구현하고 실제 Docker 환경에서 검증했다:

```ts
// services/order-outbox/src/shared/admin-events.service.ts
@Injectable()
export class AdminEventsService {
  private readonly subject = new Subject<AdminLogEvent>();
  readonly stream$ = this.subject.asObservable();
  emit(type: AdminLogEvent["type"], message: string): void {
    this.subject.next({ type, message, at: new Date().toISOString() });
  }
}

// services/order-outbox/src/shared/admin-logs.controller.ts
@Controller("admin/logs")
export class AdminLogsController {
  constructor(private readonly adminEvents: AdminEventsService) {}
  @Sse("stream")
  stream(): Observable<MessageEvent> {
    return this.adminEvents.stream$.pipe(map((event) => ({ data: event })));
  }
}
```

실제 주문 하나를 생성해서 `created`(api 프로세스) → `published`(api 프로세스) →
`confirmed`(fulfillment, 별도 컨테이너) 3개 이벤트가 정확한 순서로 SSE 스트림에 도착하는
걸 `curl -sN`으로 확인했다.

이 파일 2개는 order-outbox의 도메인 로직(주문/outbox)과 전혀 무관한 순수 인프라 코드다 —
`AdminEventsService`는 `type`/`message`/`at` 세 필드짜리 제네릭 이벤트를 rxjs `Subject`로
브로드캐스트할 뿐이고, `AdminLogsController`는 NestJS 표준 `@Sse()` 데코레이터를 그대로
감싼 것뿐이다. 이제 이 패턴을 나머지 3개 실험(waiting-room, live-ranking, msa-checkout)에도
확산하려는데, 그러면 이 두 파일을 토씨 하나 안 바꾸고 4번 복붙하게 된다 — `node-forge`가
이미 `logger`/`metrics`/`health` 모듈로 "관측성 공통 인프라"를 제공하고 있는 것과 정확히
같은 성격의 반복이라, 여기 올리는 게 맞다고 판단했다.

## 현재 forge로 안 되는 이유

- `logger`/`metrics`/`health` 모듈은 각각 로그 출력, 지표 수집, 헬스체크를 담당하지만,
  "프로세스 안에서 일어난 임의의 이벤트를 실시간으로 구독하게 해주는" 기능은 없다.
- NestJS의 `@Sse()` 데코레이터 자체는 프레임워크 표준 기능이라 forge가 대신할 필요는
  없지만, "이벤트 버스 + 그걸 SSE로 노출하는 컨트롤러"를 매번 새로 만드는 보일러플레이트는
  forge가 흡수할 수 있는 부분이다.

## 제안하는 API 형태

`@paikpaik/node-forge/events`(코어) + `@paikpaik/node-forge/events/nestjs`(NestJS 통합)
신규 모듈을 제안한다. 기존 `HealthModule.forRoot({...})`, `MetricsModule.forRoot({})`와
같은 `forRoot()` 등록 방식을 그대로 따른다.

```ts
// core
export class AdminEventBus<T = unknown> {
  private readonly subject = new Subject<T>();
  readonly stream$: Observable<T> = this.subject.asObservable();
  emit(event: T): void {
    this.subject.next(event);
  }
}

// nestjs — 이벤트 버스 등록 + SSE 컨트롤러(<path>/stream)까지 한 번에 생성
export const ADMIN_EVENT_BUS = Symbol("ADMIN_EVENT_BUS");

interface AdminEventsModuleOptions {
  path: string; // 예: "admin/logs" → GET /admin/logs/stream
}

@Module({})
export class AdminEventsModule {
  static forRoot(options: AdminEventsModuleOptions): DynamicModule {
    // ADMIN_EVENT_BUS provider + path에 맞는 @Sse 컨트롤러를 동적으로 구성해서 반환
  }
}
```

각 서비스는 이렇게만 쓰면 된다:

```ts
// app.module.ts
imports: [AdminEventsModule.forRoot({ path: "admin/logs" })]

// 도메인 서비스 안에서
constructor(@Inject(ADMIN_EVENT_BUS) private readonly events: AdminEventBus<AdminLogEvent>) {}
this.events.emit({ type: "created", message: "...", at: new Date().toISOString() });
```

이벤트의 실제 타입(`type`/`message` 필드 구성)은 제네릭으로 열어둬서, 각 실험이 자기
도메인에 맞는 이벤트 payload를 자유롭게 정의하게 한다 — forge는 "버스 + SSE 노출"이라는
배관만 제공한다.

## 검증 포인트

- `AdminEventsModule.forRoot()`로 등록한 서비스에서 여러 SSE 클라이언트가 동시에 연결해도
  전부 같은 이벤트를 받는지(멀티캐스트)
- 클라이언트 연결이 끊겼을 때 서버 쪽에서 구독이 정상적으로 정리되는지(메모리 누수 없음)
- 기존 order-outbox의 수기 구현과 동일하게, cross-process(예: order-outbox의 api/
  fulfillment처럼 여러 프로세스가 각자 자기 이벤트만 스트리밍)로 나눠 써도 문제없는지

## 대안으로 검토했지만 기각한 방법

- **각 서비스가 계속 복붙**: 지금은 파일 2개(30줄 안팎)라 부담이 적어 보이지만, 실험이
  늘어날수록(5번째, 6번째...) 반복이 커지고, 향후 SSE 재연결/하트비트/인증 같은 개선이
  필요해지면 4곳을 전부 따로 고쳐야 한다. `logger`/`metrics`/`health`를 이미 forge로
  올린 이유와 동일한 논리로 기각.
- **컨트롤러는 각 서비스가 직접 작성, `AdminEventBus`만 forge 제공**: kafka-forge의
  `IdempotencyStore`(인터페이스만 제공, 구현은 소비 서비스 책임)와 비슷한 절충안도
  검토했다. 하지만 이번 케이스는 `IdempotencyStore`와 달리 컨트롤러 쪽에 저장소별
  차이(Redis vs 메모리 등)가 전혀 없는 100% 보일러플레이트라, 나눠서 얻는 이점이 없어
  기각 — 통짜로 `forRoot()`에 넣는 게 더 단순하다.
