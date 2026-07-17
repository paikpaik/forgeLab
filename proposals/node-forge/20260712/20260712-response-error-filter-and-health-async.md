# node-forge 제안 — 에러 응답 필터, HealthModule.forRootAsync

## 계기

`services/waiting-room`(NestJS)에서 `@paikpaik/node-forge`의 `response`, `health`, `redis` 모듈을
실 소비자로 붙이면서 두 가지 이가 발견됐다.

## 1. `ResponseInterceptor`는 있는데 에러용 짝이 없음

### 현재 한계

`response/nestjs`의 `ResponseInterceptor`는 컨트롤러가 반환한 값을 `ok(data)`로 감싸주지만,
`ForgeBizError`/`ForgeHttpError`가 던져졌을 때 이를 `fail(code, message)` 포맷으로 변환해서
HTTP 응답을 만들어주는 `ExceptionFilter`는 없다. 결과적으로 성공 응답은 `ApiResponse` 포맷을
자동으로 따르지만, 에러 응답은 각 서비스가 매번 필터를 직접 구현해야 한다.

우회: `services/waiting-room/src/common/forge-error.filter.ts`에 `@Catch(ForgeBizError, ForgeHttpError)`
필터를 직접 작성해서 사용 중이다.

### 제안

`response/nestjs`에 `ForgeExceptionFilter` 같은 이름으로 아래를 제공:

```ts
@Catch(ForgeBizError, ForgeHttpError)
export class ForgeExceptionFilter implements ExceptionFilter {
  catch(exception: ForgeBizError | ForgeHttpError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const statusCode = exception instanceof ForgeHttpError ? exception.statusCode : 400;
    response.status(statusCode).json(fail(exception.code, exception.message));
  }
}
```

`ResponseInterceptor`와 짝을 이루면 `app.useGlobalInterceptors(new ResponseInterceptor())` +
`app.useGlobalFilters(new ForgeExceptionFilter())` 두 줄로 성공/실패 응답 포맷이 모두 표준화된다.

### 기각한 대안

- 서비스마다 직접 구현: 지금 하고 있는 방식이지만, node-forge를 쓰는 모든 NestJS 서비스가
  똑같은 필터를 반복 작성하게 된다 — `response` 모듈이 애초에 성공/실패 응답 포맷 통일을
  목표로 하는 모듈이므로 반쪽짜리가 된다.

---

## 2. `HealthModule.forRoot()`가 다른 Forge 모듈의 DI 인스턴스를 재사용하기 어려움

### 현재 한계

`HealthModule.forRoot({ checkers })`는 `checkers`를 모듈 정의 시점에 동기적으로 받는다. 반면
`RedisModule.forRoot(options)`은 내부적으로 `useFactory`로 `ForgeRedisClient`를 만들어 DI
컨테이너에만 등록한다 — `AppModule`을 작성하는 시점에는 아직 그 인스턴스에 접근할 방법이 없다.

`RedisModule`이 만든 인스턴스로 `createRedisHealthChecker()`를 만들려면 두 가지 중 하나를
골라야 한다: (a) `createRedisClient()`로 헬스체크 전용 인스턴스를 하나 더 만들거나(연결 중복),
(b) `RedisModule.forRootAsync`처럼 DI 이후 시점에 checker를 조립할 방법이 있어야 한다.

우회: `services/waiting-room/src/app.module.ts`에서 헬스체크 전용 `ForgeRedisClient`를
별도로 생성해서 쓰고 있다 (연결 1개가 추가로 열림, 실험 스코프에서는 무해하지만 프로덕션에서는
낭비).

### 제안

`RedisModule`/`LoggerModule`과 동일한 패턴으로 `HealthModule.forRootAsync`를 추가:

```ts
export interface HealthAsyncOptions extends Pick<ModuleMetadata, "imports"> {
  useFactory: (...args: unknown[]) => Record<string, HealthChecker> | Promise<Record<string, HealthChecker>>;
  inject?: FactoryProvider["inject"];
}
```

이러면 `REDIS_CLIENT` 토큰을 `inject`로 받아서 `createRedisHealthChecker(redisClient)`를
DI 해석 이후 시점에 조립할 수 있다.

### 기각한 대안

- `HealthModule`을 `@Global()`로 바꾸고 자체적으로 다른 forge 모듈을 알게 하기: 모듈 간
  결합도가 올라가고, `health` 모듈이 `redis`/`database`를 몰라야 한다는 기존 설계(선택적
  의존성, 인터페이스로만 확장)에 어긋난다.
