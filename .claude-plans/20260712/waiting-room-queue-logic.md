## 플랜 실행 이력

### 완료: 2026-07-12

**결과**: 성공. Docker로 실기동해서 등록/조회/중복에러/admission/메트릭까지 전부 curl로 검증했고, dashboard의 up/down/status/seed 버튼으로도 재검증함.

**실제 변경 파일**:
- 계획된 파일 전부 계획대로 생성 (`waiting-room.constants.ts`, `dto/*`, `waiting-room.service.ts`, `admission.service.ts`, `token.service.ts`, `waiting-room.metrics.ts`, `waiting-room.controller.ts`, `waiting-room.module.ts`)
- `main.ts` — 처음엔 로컬 `ForgeErrorFilter`(express `Response` 하드코딩)를 직접 구현했다가, node-forge 1.0.1에 정식 `ForgeExceptionFilter`가 추가된 뒤 그걸로 교체하고 로컬 필터 삭제
- `app.module.ts` — 처음엔 헬스체크 전용 `ForgeRedisClient`를 별도로 만들어 썼다가, node-forge 1.0.1의 `HealthModule.forRootAsync` 추가 후 `RedisModule`의 DI 인스턴스를 재사용하도록 교체
- `waiting-room.controller.ts` — `ResponseInterceptor`를 전역이 아니라 `@UseInterceptors(ResponseInterceptor)`로 컨트롤러에만 적용 (전역으로 걸었다가 `/metrics`까지 JSON으로 감싸버리는 걸 실제로 발견해서 수정)

**계획과의 차이**:
- **node-forge 버그 3건을 실제 소비 중 발견**: (1) `exports` 맵의 `require` 조건이 존재하지 않는 `.cjs`를 가리켜 CJS 소비 자체가 불가능했던 버그, (2) `ResponseInterceptor`는 있는데 에러용 필터가 없던 gap, (3) `HealthModule.forRoot()`가 다른 forge 모듈의 DI 인스턴스를 재사용 못 하던 gap. 전부 `proposals/node-forge/`에 제안서로 남기고 사용자가 직접 수정 → 1.0.1로 배포
- **1.0.1 배포 직후 4번째 버그 발견**: `tsup.config.ts`의 `splitting: false` 때문에 엔트리마다 `ForgeBizError` 클래스가 중복 번들링되어 `ForgeExceptionFilter`의 `instanceof` 매칭이 실패하던 문제. 제안서 작성 → 사용자가 `splitting: true`로 수정 + npm pack 기반 스모크 테스트를 CI에 추가 → 1.0.2로 배포
- 계획에는 없었지만 실제 검증 중 발견한 것: `/metrics`가 전역 `ResponseInterceptor`에 걸려 JSON으로 감싸지던 문제 (저희 쪽 실수, node-forge 문제 아님) → 컨트롤러 스코프로 수정

**잔존 작업**:
- 대기열 동시성/부하 테스트(동시 등록, admission 배치 경계값)는 아직 안 함
- `seed` 스크립트 본체는 계획대로 스코프 아웃 상태 유지 (dashboard에서 호출 시 명확한 에러로 확인됨)

---

# waiting-room-queue-logic — Redis ZSET 기반 대기열 등록/조회/admission 로직 설계

## 목표

`services/waiting-room`(NestJS 골격은 `forge-lab-structure.md` 플랜에서 스캐폴딩)에 실제 대기열 비즈니스 로직을 구현한다: 사용자 등록, 순번 조회, 주기적 admission(입장 허용) 처리, 대기열 관측(길이·평균 대기시간). `node-forge`를 실 소비자로 검증하는 것이 목적이므로, 가능한 한 `ForgeRedisClient`가 이미 제공하는 원자적 연산을 그대로 쓴다.

## 현재 상태 (AS-IS)

`services/waiting-room`은 아직 `health` 모듈만 있는 골격 상태(별도 플랜)다. 대기열 로직은 없다.

`forge/node-forge/src/redis/redis.ts`를 확인한 결과, 아래가 이미 구현되어 있다 — 새로 만들 필요 없음:

- `zadd(key, entries)` — score/member 등록
- `zscore(key, member)` — 특정 멤버 score 조회 (재등록 방지 체크용)
- `zrank(key, member)` — 오름차순 0-based 순위 (= 도착 순서)
- `zcard(key)` — 대기열 길이
- `zpopmin(key, count)` — **score가 가장 낮은 count개를 조회+제거를 원자적으로 수행** (admission 동시성 문제를 이미 해결해주는 Redis 네이티브 명령. 별도 Lua 스크립트 불필요 — 사용자 확인 완료)
- `set(key, value, expireSeconds)` — TTL 있는 값 저장 (admitted 상태 저장용)
- `get(key)` — 값 조회
- `buildKey(...parts)` — 키 네이밍 헬퍼

## 변경 후 상태 (TO-BE)

### Redis 키 스키마 (roomId로 스코프, 향후 여러 대기열 지원)

| 키 | 타입 | 용도 |
|----|------|------|
| `waiting:{roomId}:queue` | ZSET | member=`userId`, score=등록 시각(`Date.now()` ms) |
| `waiting:{roomId}:admitted:{userId}` | STRING (TTL) | admission 시 발급한 입장 토큰. TTL 경과 후 자동 소멸 |

**score를 등록 시각(ms epoch)으로 사용하는 이유**: 대안으로 `INCR` 기반 단조증가 시퀀스도 검토했지만, 그러면 "평균 대기 시간"을 구하기 위해 등록 시각을 별도 키에 또 저장해야 한다. `Date.now()`를 score로 쓰면 `admittedAt - score`로 대기시간이 바로 나오고 구조가 단순해진다. 동일 밀리초에 여러 요청이 들어와 순서가 살짝 뒤섞일 수 있지만, 실제 대기열에서도 밀리초 단위 동시 요청의 상대 순서는 임의여도 무방하다고 판단했다 (순수 기술적이고 되돌리기 쉬운 결정으로 판단해 별도 확인 없이 진행).

### API

| 메서드/경로 | 설명 |
|-------------|------|
| `POST /rooms/:roomId/waiting-users` | 대기 등록. body `{ userId }` → `zscore`로 중복 등록 체크 후 `zadd(queue, [{score: Date.now(), member: userId}])`. 응답: `ok({ position, queueLength })` (position은 `zrank+1`) |
| `GET /rooms/:roomId/waiting-users/:userId` | 상태 조회. 1) `get(admitted:{userId})` 확인 → 있으면 `{status:'admitted', token}` 2) 없으면 `zrank(queue, userId)` → null이면 `{status:'not_found'}`, 아니면 `{status:'waiting', position, queueLength}` |

Admission은 별도 API가 아니라 서버 내부 스케줄러가 트리거한다 (사용자 확인 완료).

### Admission 스케줄러

`@nestjs/schedule`의 `@Interval(ADMISSION_INTERVAL_MS)`로 등록된 서비스가 활성 room마다:

1. `zpopmin(queue, ADMISSION_BATCH_SIZE)` → 제거된 `{member, score}[]` 획득 (member=userId, score=등록시각)
2. 각 userId에 대해 HMAC 기반 입장 토큰 발급 (`crypto.createHmac('sha256', ADMISSION_TOKEN_SECRET)` — 별도 JWT 라이브러리 의존성 추가하지 않음, 실험 스코프에 필요한 수준의 서명 토큰이면 충분)
3. `set(admitted:{userId}, token, ADMITTED_TOKEN_TTL_SECONDS)`
4. 대기시간(`Date.now() - score`)을 히스토그램에 기록, admission 카운터 증가

활성 room 목록을 어떻게 알 것인가: v0는 `ADMISSION_ROOM_IDS`(콤마 구분 환경변수) 또는 가장 단순하게 **room 하나만 우선 지원**(`ROOM_ID` 고정값)하고, 여러 room 순회는 실제로 두 번째 room이 필요해질 때 추가한다 (YAGNI — 미리 멀티룸 스케줄링 로직을 만들지 않는다). API 경로는 `:roomId`를 받게 해서 인터페이스는 열어두되, 스케줄러 내부 순회 로직만 단일 room으로 시작.

### 대기열 관측 (`ForgeMetrics`)

- `Gauge waiting_room_queue_length{roomId}` — 등록/조회/admission 시점에 `zcard`로 갱신
- `Histogram waiting_room_wait_time_ms{roomId}` — admission 시 대기시간 기록
- `Counter waiting_room_admissions_total{roomId}` — admission 처리된 누적 인원

`MetricsModule.forRoot()`가 이미 `/metrics` 엔드포인트를 노출하므로 별도 컨트롤러 불필요.

## 변경 범위

| 파일 | 변경 내용 |
|------|----------|
| `services/waiting-room/src/waiting-room/waiting-room.module.ts` | 신규. Controller/Service/AdmissionService/TokenService/Metrics provider 등록 |
| `services/waiting-room/src/waiting-room/waiting-room.controller.ts` | 신규. 등록/조회 두 엔드포인트 |
| `services/waiting-room/src/waiting-room/waiting-room.service.ts` | 신규. `register()`, `getStatus()` — zadd/zscore/zrank/zcard 사용 |
| `services/waiting-room/src/waiting-room/admission.service.ts` | 신규. `@Interval` 스케줄러 — zpopmin + 토큰 발급 + 메트릭 |
| `services/waiting-room/src/waiting-room/token.service.ts` | 신규. HMAC 서명 토큰 발급/검증 |
| `services/waiting-room/src/waiting-room/waiting-room.constants.ts` | 신규. 키 빌더, 환경변수 기반 설정값 |
| `services/waiting-room/src/waiting-room/waiting-room.metrics.ts` | 신규. Gauge/Histogram/Counter 정의 |
| `services/waiting-room/src/waiting-room/dto/*.ts` | 신규. 요청/응답 DTO (class-validator) |
| `services/waiting-room/src/app.module.ts` | 수정. `RedisModule.forRoot()`, `MetricsModule.forRoot()`, `ScheduleModule.forRoot()`, `WaitingRoomModule` import 추가 |
| `services/waiting-room/package.json` | 수정. `@nestjs/schedule` 의존성 추가 |
| `services/waiting-room/.env.example` | 수정. `ADMISSION_INTERVAL_MS`, `ADMISSION_BATCH_SIZE`, `ADMITTED_TOKEN_TTL_SECONDS`, `ADMISSION_TOKEN_SECRET`, `ROOM_ID` 추가 |

## 영향성

| 영향 대상 | 영향 내용 |
|-----------|----------|
| `health` 모듈 (선행 플랜) | 변경 없음 |
| `dashboard` (선행 플랜) | 변경 없음. 이 서비스가 docker-compose로 뜬 뒤에는 `/health`, `/metrics` 응답이 풍부해지지만 dashboard 쪽 코드 수정은 필요 없음 |
| node-forge | 코드 수정 없음. `zpopmin`/`zrank`/`zadd`/`zscore`/`set`/`get`을 실 소비자로 사용해서 검증 |
| kafka-forge | 이번 스코프 제외 (사용자 확인 완료) — admission 이벤트 발행은 다음 실험/단계로 분리 |

## Breaking Changes

없음 (신규 생성).

## 위험도

**MEDIUM** — 단일 서비스(`waiting-room`) 내부 로직이라 다른 서비스에는 영향 없지만, admission 스케줄러의 동시성(다중 인스턴스로 스케일 아웃 시 같은 room을 여러 인스턴스가 동시에 스케줄링하는 경우)은 이번 스코프에서 다루지 않는다 — `zpopmin`이 원자적이라 "중복 입장 허용"은 발생하지 않지만, 인스턴스별로 각자 배치를 소비하므로 배치 크기가 의도보다 커질 수 있다. 단일 인스턴스 실행을 전제로 한다 (docker-compose 기준 `app` 컨테이너 1개).

## 주의사항

- `zadd`는 이미 존재하는 member의 score를 덮어쓴다. 재등록 시 순번이 초기화되는 버그를 막기 위해 반드시 `zscore`로 존재 여부를 먼저 확인하고, 있으면 `ForgeBizError('E9409', '이미 대기 중인 사용자입니다')`를 던진다.
- HMAC 토큰은 `crypto.timingSafeEqual`로 검증해서 타이밍 공격을 피한다 (단순 문자열 `===` 비교 금지).
- `ADMISSION_TOKEN_SECRET`은 `.env.example`에 플레이스홀더만 두고 실제 값은 커밋하지 않는다.
- 멀티룸 스케줄링, kafka 이벤트, 분산 인스턴스 간 admission 조율은 이번 스코프가 아니다 — 필요해지면 그때 별도 플랜으로 확장한다 (미리 추상화하지 않는다).

## 작업 단계

### 1단계: 등록/조회 API

1. `waiting-room.constants.ts` — 키 빌더(`buildKey` 활용), 환경변수 로더
2. `dto/register-waiting-user.dto.ts`, `dto/waiting-status.dto.ts`
3. `waiting-room.service.ts` — `register(roomId, userId)`, `getStatus(roomId, userId)`
4. `waiting-room.controller.ts` — 두 엔드포인트, node-forge `response/nestjs` 인터셉터로 표준 응답 포맷 적용
5. `waiting-room.module.ts`에 등록, `app.module.ts`에 import

### 2단계: admission 스케줄러 + 토큰

1. `token.service.ts` — HMAC 발급/검증
2. `admission.service.ts` — `@Interval`로 `zpopmin` 호출, 토큰 발급, `admitted` 키 저장
3. `@nestjs/schedule` 의존성 추가, `app.module.ts`에 `ScheduleModule.forRoot()` 추가

### 3단계: 관측

1. `waiting-room.metrics.ts` — Gauge/Histogram/Counter 정의
2. `waiting-room.service.ts`/`admission.service.ts`에서 해당 시점마다 지표 갱신
3. `MetricsModule.forRoot()` 연결 확인 (`/metrics` 응답에 새 지표가 노출되는지)

## 검증 방법

1. `docker compose up --build -d` (waiting-room + redis)로 기동
2. `curl -X POST localhost:<port>/rooms/test/waiting-users -d '{"userId":"u1"}'` → `position: 1` 확인
3. 같은 `userId`로 재등록 시도 → `E9409` 에러 응답 확인 (200 성공이 아니어야 함)
4. `curl localhost:<port>/rooms/test/waiting-users/u1` → `status: 'waiting'` 확인
5. `ADMISSION_INTERVAL_MS`를 짧게(예: 2000) 설정한 뒤 대기 → 다음 스케줄 틱 이후 같은 조회 API가 `status: 'admitted'`와 토큰 반환 확인
6. `curl localhost:<port>/metrics`에서 `waiting_room_queue_length`, `waiting_room_wait_time_ms`, `waiting_room_admissions_total` 지표 노출 확인
7. `zadd`/`zpopmin`/`zrank` 등에서 node-forge 쪽 버그나 부족한 점을 발견하면 구현을 멈추고 `proposals/node-forge/`에 제안서부터 작성

## 참조 규칙

- `.claude/rules/common/principles.md` — 멀티룸/kafka 등 요청받지 않은 범위 미리 확장하지 않음
- `.claude/rules/common/workflow.md` — forge 부족 기능 발견 시 제안서부터 작성하고 우회 구현으로 넘어가지 않음
- `.claude/rules/project/convention.md` — `@paikpaik/node-forge`는 GitHub Packages 설치본 사용, 대시보드는 오케스트레이션 전담
