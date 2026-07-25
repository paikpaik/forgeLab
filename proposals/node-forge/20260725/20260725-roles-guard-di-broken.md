# node-forge 버그 — `auth/nestjs`의 `RolesGuard`가 실제 배포 빌드에서 `Reflector` 주입 실패

## 계기

`services/msa-checkout`을 node-forge 1.0.5로 올리고(`@paikpaik/node-forge/auth/nestjs`의
`JwtAuthGuard`/`RolesGuard`/`Roles`로 로컬 우회 코드를 걷어내는 라운드) 실제 컨테이너에서
재검증하던 중, `RolesGuard`를 쓰는 모든 라우트가 500 Internal Server Error를 던지는 것을
실제로 재현했다.

```
TypeError: Cannot read properties of undefined (reading 'getAllAndOverride')
    at RolesGuard.canActivate (/app/node_modules/@paikpaik/node-forge/dist/auth/nestjs/index.js:68:42)
```

## 원인

실제 배포된 `dist/auth/nestjs/index.js`를 직접 열어서 비교한 결과:

```js
// JwtAuthGuard — 정상 동작 (파라미터 데코레이터로 토큰을 명시)
var JwtAuthGuard = class {
  constructor(options) { this.options = options; }
  ...
};
JwtAuthGuard = __decorateClass([
  Injectable(),
  __decorateParam(0, Inject(AUTH_OPTIONS))   // ← 이게 있어서 DI가 뭘 주입할지 안다
], JwtAuthGuard);

// RolesGuard — 여기서 문제 발생
var RolesGuard = class {
  constructor(reflector) { this.reflector = reflector; }
  ...
};
RolesGuard = __decorateClass([
  Injectable()                                // ← 파라미터 데코레이터가 없음
], RolesGuard);
```

`RolesGuard`의 생성자는 `constructor(private readonly reflector: Reflector)`처럼 **타입
추론에만 의존**하고 명시적 `@Inject()`가 없다. 소스 레벨(TypeScript, `emitDecoratorMetadata:
true`)에서는 문제없이 동작하지만, node-forge는 tsup(esbuild 기반)으로 빌드하는데 esbuild는
`emitDecoratorMetadata`가 만드는 `design:paramtypes` 메타데이터를 방출하지 않는다. 그 결과
실제로 npm에 배포된 `dist`에는 "이 생성자의 첫 번째 인자가 `Reflector` 타입"이라는 정보가
전혀 남지 않고, NestJS의 DI 컨테이너가 무엇을 주입해야 할지 몰라 `undefined`를 넘긴다.

이 문제는 order-outbox 라운드에서 겪었던 것과 같은 근본 원인(esbuild류 트랜스폼이
`emitDecoratorMetadata`를 방출하지 않음)이지만, 그때는 **소비 서비스의 테스트 환경**에서
발생한 반면 이번엔 **node-forge 자신의 실제 배포 빌드**에서 발생했다는 점이 다르다 — 파라미터
데코레이터 없이 타입 추론에만 의존하는 provider를 node-forge가 export하는 한, 이걸 쓰는
모든 소비 서비스가 100% 재현되는 문제다.

## 재현

```bash
# msa-checkout/src/gateway/gateway.module.ts에 그대로 등록하고
providers: [JwtAuthGuard, RolesGuard, ...]
# @UseGuards(JwtAuthGuard, RolesGuard)가 붙은 라우트를 호출하면 매번 500
```

`{ provide: RolesGuard, useFactory: (reflector) => new RolesGuard(reflector), inject:
[Reflector] }` 형태로 소비 서비스 쪽에서 명시적으로 재정의해도 **동일한 에러가 계속
재현됐다**(원인 불명 — `@UseGuards()`가 provider 재사용이 아니라 매번 새로 인스턴스화하는
경로를 타는 것으로 추정되지만 확실하지 않음). 실제로 동작한 유일한 우회는 로컬에서
서브클래싱해 새 생성자를 만드는 것뿐이었다:

```ts
@Injectable()
export class RolesGuard extends ForgeRolesGuard {
  constructor(reflector: Reflector) { super(reflector); } // msa-checkout 자체 tsc 빌드라 메타데이터가 살아있음
}
```

## 제안

`RolesGuard`(그리고 앞으로 추가될, 파라미터 타입 추론에 의존하는 모든 forge provider)의
생성자에 명시적 `@Inject()`를 붙인다 — `JwtAuthGuard`가 이미 하고 있는 것과 동일한 패턴.

```ts
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}
  ...
}
```

`Reflector`는 `@nestjs/core`가 제공하는 내장 클래스라 별도 토큰 심볼을 만들 필요 없이
`@Inject(Reflector)`로 클래스 자체를 토큰으로 쓰면 된다.

## 검증 포인트

- 수정 후 `RolesGuard`를 **provider 배열에 클래스 참조만 등록**(`providers: [RolesGuard]`,
  `useFactory` 우회 없이)한 상태에서 `@UseGuards(RolesGuard)`가 붙은 라우트가 정상 동작하는지
- node-forge 자신의 `roles.guard.test.ts`뿐 아니라, **실제로 빌드된 `dist`를 설치해서** 최소
  하나의 소비 앱에서 스모크 테스트하는 것도 권장 — 이번 버그는 소스 레벨 테스트(node-forge
  자체 vitest)로는 못 잡고, 빌드 산출물을 실제로 설치해서 실행해야만 드러났다. `npm pack`
  기반 스모크 테스트를 CI에 추가한 1.0.2의 `ForgeExceptionFilter` 사례와 같은 종류의 검증이
  `auth`/`grpc`처럼 새로 추가되는 모듈에도 필요해 보인다

## 기각한 대안

- **소비 서비스가 매번 `useFactory`로 명시 주입**: 시도했지만 실제로 동작하지 않았다(원인
  불명, `@UseGuards()`의 provider 해석 경로 문제로 추정). 설령 동작했더라도, node-forge를
  쓰는 모든 서비스가 이 우회를 반복해야 하는 건 라이브러리 버그를 소비자에게 떠넘기는
  것이라 근본 수정이 맞다
- **tsup 설정에서 `emitDecoratorMetadata`를 살리는 방향**: esbuild 자체가
  `emitDecoratorMetadata`를 지원하지 않아서(TypeScript 컴파일러 고유 기능), tsup에서 이걸
  살리려면 tsc를 별도로 한 번 더 돌리는 등 빌드 파이프라인이 복잡해진다. 문제가 되는
  provider 수가 적으므로(현재는 `RolesGuard` 하나) `@Inject()` 명시가 훨씬 간단하고 안전한
  해결책
