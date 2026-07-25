# node-forge 제안 — `auth` 모듈: JWT bearer 토큰 발급/검증 + NestJS Guard

## 계기

`services/msa-checkout`(forge-lab 4번째 실험)의 API 게이트웨이 인증을 처음엔 waiting-room의
`TokenService`와 같은 방식(HMAC 직접 구현, 외부 JWT 라이브러리 없음)으로 만들었다가,
**JWT(`@nestjs/jwt`)로 교체하고 실제로 재검증**했다. 교체 이유는 이 랩의 필요를 넘어선다 —
node-forge의 존재 목적이 forge-lab 검증만이 아니라 forge 자체를 실서비스에 쓸 수 있도록
고도화하는 것이고, "회원(Account) 인증의 bearer 토큰"은 실사용 서버라면 사실상 예외 없이
필요한 기초 체력이자 JWT가 사실상 업계 표준이기 때문이다.

```ts
// 지금 msa-checkout/src/shared/auth/auth-token.service.ts (검증 완료, 로컬 구현)
@Injectable()
export class AuthTokenService {
  constructor(private readonly jwtService: JwtService) {}

  issue(userId: string, role: Role): string {
    return this.jwtService.sign({ sub: userId, role });
  }

  verify(token: string): AuthUser | null {
    try {
      const claims = this.jwtService.verify<AccessTokenClaims>(token);
      if (claims.role !== "customer" && claims.role !== "admin") return null;
      return { userId: claims.sub, role: claims.role };
    } catch {
      return null;
    }
  }
}
```

이 코드와 `AuthGuard`/`RolesGuard`(Bearer 헤더 추출 → 검증 → `request.user` 세팅 → role
비교)는 다음 실험이 인증이 필요할 때마다 매번 새로 쓰게 될 보일러플레이트다.

## 현재 한계

node-forge에는 인증/인가 관련 모듈이 전혀 없다. Redis/DB/HTTP/이벤트/메트릭 모듈은 있지만,
"bearer 토큰을 발급하고, 요청에서 꺼내 검증하고, role로 인가한다"는 실사용 서버의 가장 기본적인
축이 빠져 있다.

## 제안

`auth` 모듈을 신설한다. node-forge의 기존 모듈 컨벤션(`core`/`nestjs`/`fastify` 3-path)을
따르되, **Account 저장(회원 정보 영속화)이나 refresh-token 로테이션, JWKS/비대칭키 순환 같은
건 스코프에서 제외**한다 — 이 랩의 두 실험(waiting-room, msa-checkout) 어디에도 아직 필요한
적이 없고, node-forge가 이미 지켜온 "저장소는 소비 서비스 책임"(`IdempotencyStore`,
`OutboxStore`와 동일한 원칙) 원칙에도 맞다. 딱 "토큰 발급/검증 + role 기반 가드"까지만 제안한다.

```ts
// @paikpaik/node-forge/auth (core, jsonwebtoken 직접 사용 — 프레임워크 무관)
export interface SignTokenOptions {
  secret: string;
  expiresIn: string; // "15m" 같은 형식, jsonwebtoken의 StringValue 그대로
}

export function signToken<T extends object>(claims: T, options: SignTokenOptions): string;
export function verifyToken<T extends object>(token: string, secret: string): T | null;
// 서명 불일치/만료/형식 손상 전부 예외 없이 null — msa-checkout의 verify()가 이미 이렇게
// 감싸고 있던 catch 로직을 프리미티브 레벨로 끌어올림
```

```ts
// @paikpaik/node-forge/auth/nestjs
export interface AuthedRequest<TUser = unknown> extends Request {
  user?: TUser;
}

export class JwtAuthModule {
  static forRoot(options: SignTokenOptions): DynamicModule;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  // Authorization: Bearer 추출 → verifyToken → request.user 세팅, msa-checkout의 AuthGuard와
  // 동일한 로직을 제네릭 클레임 타입으로 제공
}

export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  // request.user에서 role 필드를 꺼내 @Roles()와 비교 — msa-checkout의 RolesGuard를 그대로
  // 일반화(role 타입을 하드코딩하지 않고 string으로 비교하는 지금 구현이 이미 범용적임)
}
```

`fastify` 변형은 `preHandler` 훅으로 동일한 검증/역할 비교를 제공한다(다른 모듈들과 동일한
3-path 패턴 유지).

## 검증 포인트

- 발급한 토큰이 표준 JWT 구조(`header.payload.signature`)이고 지정한 클레임이 그대로 들어있는지
- payload를 변조(서명은 원본 그대로 붙인 채)하면 검증이 실패하는지 — msa-checkout에서 실제로
  `role: "customer"` → `"admin"`으로 바꾼 변조 토큰을 만들어 admin 라우트에 보내 401을
  확인했고, 원본 토큰으로는 정상 통과하는 것과 대조 검증함
- 다른 secret으로 서명된 토큰은 거부되는지
- `expiresIn`을 짧게(초 단위) 설정하면 실제 만료 후 검증이 실패하는지 — msa-checkout에서
  TTL 3초짜리 임시 컨테이너를 띄워 발급 직후 성공, 4초 후 401을 실제로 재현함
- `RolesGuard`가 `@Roles()` 메타데이터 없이는 통과, 있으면 role 불일치 시 403을 던지는지

## 기각한 대안

- **HMAC 직접 구현을 그대로 node-forge 프리미티브로 승격**(직전에 검토했던 방향): waiting-room과
  msa-checkout 두 사례가 구조적으로 비슷한 코드를 반복하긴 했지만, 실제로는 성격이 다르다 —
  waiting-room은 "1회성 입장권 + Redis TTL로 만료 관리"이고 msa-checkout은 "반복 가능한 API
  인증 자격증명"이다. 후자가 forge를 실서비스에 쓸 때 실제로 필요해지는 축이고, 업계 표준(JWT)을
  두고 자체 포맷을 만들 이유가 없다고 판단해 철회
- **passport-jwt 기반 Strategy 패턴 채택**: NestJS 생태계에서 흔한 방식이지만, 이 정도 규모의
  가드 하나에 Passport 전체 프레임워크(전략 등록, 세션 옵션 등)를 끌어들이는 건 과하다.
  `@nestjs/jwt`만으로 필요한 서명/검증은 충분하고, Guard도 직접 짜는 편이 의존성이 가볍다
- **Account(회원 정보) 영속화까지 이 모듈에 포함**: node-forge는 지금까지 비즈니스 데이터를
  직접 소유한 적이 없다(`database` 모듈도 DataSource 팩토리만 제공, 엔티티는 항상 소비
  서비스가 정의). 회원 정보는 서비스마다 스키마가 크게 다를 수밖에 없어 여기 포함시키지 않음
- **refresh-token, 토큰 revocation, JWKS/비대칭키 순환**: 실제로 필요해진 사례가 아직 없다.
  다음에 필요한 실험이 생기면 그때 이 모듈 위에 얹는 별도 제안으로 다루는 게 맞다
