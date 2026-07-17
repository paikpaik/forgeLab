# node-forge 버그 — `ForgeExceptionFilter`가 `ForgeBizError`를 못 잡음 (tsup 번들 중복, HIGH)

## 계기

1.0.1 배포 직후 `services/waiting-room`에서 `ForgeExceptionFilter` + `ForgeBizError`를 실제로
붙여봤다. 중복 등록 시나리오(`waiting-room.service.ts`에서
`throw new ForgeBizError("E9409", "이미 대기 중인 사용자입니다")`)를 호출했더니, 필터가 잡지
못하고 NestJS 기본 핸들러로 떨어져 `{"statusCode":500,"message":"Internal server error"}`가
반환됐다.

컨테이너 로그:

```
ExceptionsHandler.handleUnknownError ... "이미 대기 중인 사용자입니다"
```

→ `@Catch(ForgeBizError, ForgeHttpError)`가 매칭에 실패했다는 뜻 (NestJS는 내부적으로
`instanceof`로 매칭한다).

## 원인

`tsup.config.ts`가 `splitting: false`로 설정되어 있다. 이 옵션 때문에 각 엔트리(`core/index`,
`response/nestjs/index` 등)가 서로 청크를 공유하지 않고 **완전히 독립적으로 번들링**된다 —
`src/core/errors.ts`(즉 `ForgeBizError`/`ForgeHttpError`/`ForgeError` 클래스 정의)가 엔트리마다
따로 복사되어 들어간다. 실제로 확인해보면:

```bash
$ grep -n "ForgeBizError = class" dist/core/index.js
99:var ForgeBizError = class extends ForgeError {

$ grep -n "ForgeBizError = class" dist/response/nestjs/index.js
77:var ForgeBizError = class extends ForgeError {
```

두 파일에 **서로 다른 `ForgeBizError` 클래스 객체**가 각각 정의된다. 소비자 코드가
`@paikpaik/node-forge/core`에서 가져온 `ForgeBizError`로 에러를 던지면, `response/nestjs`
번들 안에 갇혀 있는 (별개의) `ForgeBizError`를 기준으로 `@Catch()`가 매칭을 시도하므로
`instanceof`가 항상 `false`가 된다.

`core`뿐 아니라 다른 모듈 간에도 내부적으로 공유하는 타입/클래스가 있다면 전부 같은 문제를
가질 수 있다 (예: `response.ts`의 `ok`/`fail`도 여러 엔트리에 중복 번들링되어 있을 텐데, 이
경우는 함수라 `instanceof` 문제는 없지만 번들 크기 중복은 마찬가지).

## 제안

`tsup.config.ts`의 `splitting: false`를 `true`로 바꾼다. 여러 엔트리 포인트가 있는 라이브러리
패키지에서 `splitting: true`는 공유 코드를 별도 청크로 추출해 엔트리 간에 import하게 만들어준다
— `core/errors`처럼 여러 엔트리가 참조하는 클래스가 **단일 인스턴스**로 유지되어
`instanceof`가 엔트리 경계를 넘어도 정상 동작한다. 부수 효과로 각 엔트리 파일 크기도 줄어든다.

```ts
export default defineConfig({
  // ...
  splitting: true, // false → true
});
```

CJS는 청크 분리 시 `require()` 상호 참조 파일이 늘어나는데, Node의 CJS는 이를 문제없이
처리한다 (ESM도 마찬가지). `dts: true`(타입 선언)에는 영향 없음.

## 검증 포인트

```bash
grep -c "ForgeBizError = class" dist/core/index.js dist/response/nestjs/index.js dist/response/nestjs/index.mjs
# 수정 전: 파일마다 1개씩(중복) → 수정 후: core에는 정의, 나머지는 import만 하고 정의가 없어야 함
```

그리고 통합 테스트로 "다른 서브패스에서 가져온 에러 클래스가 필터에 잡히는지"를 추가하는 걸
권한다 — `response.filter.test.ts`가 지금은 필터를 단독으로만 테스트해서 이런 크로스 엔트리
`instanceof` 문제를 못 잡는다. 예: `core`에서 import한 `ForgeBizError`로 인스턴스를 만들고,
`response/nestjs`에서 import한 `ForgeExceptionFilter`의 `@Catch` 데코레이터가 그 인스턴스를
실제로 매칭하는지(예: `Reflect.getMetadata`로 캐치 대상 확인, 또는 NestJS 테스트 하네스로 e2e)
확인하는 테스트.

## 상태

`services/waiting-room`에서 `ForgeExceptionFilter`를 실제로 켜서 확인하다가 발견. 지금은 다시
로컬 필터로 되돌리지 않고, node-forge 쪽 수정을 기다리는 중.
