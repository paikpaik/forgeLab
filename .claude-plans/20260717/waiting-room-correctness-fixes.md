## 플랜 실행 이력

### 완료: 2026-07-17

**결과**: 성공 (HIGH 4건 전부 수정 + 실제 검증 완료)

**실제 변경 파일**:
- `src/waiting-room/waiting-room.service.ts` — `register()`를 `getClient().zadd(key, "NX", ...)` 원자적 방식으로 교체, `roomId !== ADMISSION_ROOM_ID` 검증 추가, `verifyToken()` 신규
- `src/waiting-room/waiting-room.controller.ts` — `POST /rooms/:roomId/waiting-users/verify` 추가 (`@HttpCode(200)` — 자원 생성이 아니므로 기본 201 대신 200)
- `src/waiting-room/admission.service.ts` — `Promise.all` → `Promise.allSettled`, 실패한 멤버는 원래 score로 재등록, 성공 건수 기준으로 메트릭 갱신
- `src/waiting-room/dto/verify-token.dto.ts` — 신규
- `src/waiting-room/dto/waiting-status.dto.ts` — `VerifyTokenResultDto` 추가
- `ARCHITECTURE.md` — API 표에 verify 추가, 설계 결정 3건 추가

**계획과의 차이**:
- verify 엔드포인트에 `@HttpCode(200)` 추가 — 계획엔 없었지만 테스트 중 기본 `201`이 의미상 안 맞는 걸 발견해서 즉시 수정
- Docker 재빌드가 `registry-1.docker.io` 연결 리셋(일시적 네트워크 문제)으로 막혀서, 검증은 Docker 대신 `docker compose up -d redis`(로컬 캐시 이미지, 네트워크 불필요) + `npm run start:dev`(ts-node-dev, REDIS_HOST=localhost)로 진행. 코드/동작은 Docker 배포판과 동일 — Dockerfile/docker-compose.yml은 변경 없음

**검증 결과**:
1. 같은 userId로 10개 동시 등록 → 1건만 성공(`201`), 9건 `E9409`(`400`) — 레이스 컨디션 해결 확인
2. 등록 성공한 유저가 admission 스케줄러로 정상 처리되어 토큰 발급됨
3. 발급된 실제 토큰으로 verify → `valid:true` + `userId`. 조작/쓰레기 토큰 → `valid:false`, HTTP `200`
4. `other-room`으로 등록 시도 → `E9400`(`400`)으로 명시적 거부 (이전엔 `201` 성공 후 조용히 방치됐음)
5. reset/health/metrics 회귀 확인 및 `tsc` 빌드 통과

**잔존 작업**:
- MEDIUM/LOW 항목(Redis 볼륨 없음, reset 무보호, 기본 시크릿, TTL 만료 후 상태 구분 불가, 테스트 부재, 입력 검증/rate limit 없음, queueLength 수동 갱신)은 이번 스코프에서 다루지 않음 — 별도 플랜 필요

### 후속: 2026-07-17 (같은 날, node-forge 1.0.3 반영)

`getClient().zadd(key, "NX", ...)` 우회를 제안서(`proposals/node-forge/20260717/20260717-zadd-nx-option.md`)로
남겼는데, 사용자가 당일 node-forge에 `zadd(key, entries, { mode: "NX"|"XX", ch? })` 옵션을
구현해 1.0.3으로 배포함. forge-lab을 1.0.3으로 올리고 `register()`를 `getClient()` 우회 없이
`this.redis.zadd(key, [...], { mode: "NX" })` wrapped API로 되돌림. Docker 네트워크도 복구되어
`docker compose up --build -d`로 재검증 완료 — 동시 등록 10건 중 1건만 성공하는 것 재확인.
`docs/issues.md`에 1.0.3 항목 추가.

---

# waiting-room-correctness-fixes — 대기열 정합성 HIGH 이슈 4건 수정

## 목표

waiting-room 코드 리뷰에서 발견한 HIGH 심각도 정합성 문제 4건을 고친다: 중복 등록 방지의
레이스 컨디션, 발급만 되고 검증되지 않는 입장 토큰, admission 부분 실패 시 유저 유실,
지원하지 않는 room으로 등록 시 조용한 기아 상태. MEDIUM/LOW(Redis 볼륨, reset 보호, 기본
시크릿, TTL 만료 후 상태 구분, 테스트 부재 등)는 이번 스코프에서 제외하고 별도로 다룬다.

## 현재 상태 (AS-IS)

**1. `register()` TOCTOU** — `waiting-room.service.ts`
```ts
const existing = await this.redis.zscore(key, userId);   // 조회
if (existing !== null) throw new ForgeBizError("E9409", ...);
await this.redis.zadd(key, [{ score: Date.now(), member: userId }]); // 쓰기(원자성 없음)
```
동시에 같은 userId로 등록하면 둘 다 통과해서 두 번째가 첫 번째 순번을 덮어씀.

**2. `TokenService.verify()`가 어디서도 호출되지 않음** — 발급(`issue`)만 admission에서
쓰이고, 검증 경로/엔드포인트가 전무.

**3. `AdmissionService.runAdmission()` 부분 실패 시 유저 유실** — `zpopmin`이 이미 대기열에서
제거(커밋)한 뒤, 토큰 저장(`redis.set`)이 실패하면 그 유저는 대기열에도 admitted에도 없는
상태로 사라짐. `Promise.all`이라 하나라도 실패하면 그 배치의 메트릭 갱신도 통째로 스킵됨.

**4. 다른 `roomId`로 등록해도 성공 응답 — 하지만 영원히 admission 안 됨** — admission
스케줄러는 `ADMISSION_ROOM_ID`(환경변수) 하나만 순회. API는 `:roomId`를 받지만 실제로
동작하는 room은 하나뿐이라는 걸 강제하는 코드가 없음.

## 변경 후 상태 (TO-BE)

**1.** `zscore`+`zadd` 대신 `ZADD NX`(없을 때만 추가, 원자적)로 교체. `ForgeRedisClient.zadd`는
NX 옵션이 없으므로 `redis.getClient()`(문서화된 raw ioredis 탈출구)로 직접 호출.
```ts
const added = await this.redis.getClient().zadd(key, "NX", Date.now(), userId);
if (added === 0) throw new ForgeBizError("E9409", "이미 대기 중인 사용자입니다");
```

**2.** `POST /rooms/:roomId/waiting-users/verify` 엔드포인트 추가. `TokenService.verify()`로
서명 검증 후, Redis의 `admittedKey`에 저장된 값과 일치하는지 추가로 대조(서명은 유효해도
TTL 만료·재발급으로 Redis 쪽 값이 다르면 무효 처리) — "실제 서비스가 이 토큰 들고 오면
입장 가능한지 확인"하는 용도를 완성한다.

**3.** `Promise.all` → `Promise.allSettled`로 변경. 실패한 멤버는 원래 score로 다시
`zadd`해서 대기열에 복구(유실 방지)하고 에러 로그를 남긴다. 메트릭은 성공한 건수 기준으로만
갱신(부분 실패가 전체를 막지 않음).

**4.** `register()` 시작 시 `roomId !== ADMISSION_ROOM_ID`면 즉시 `ForgeBizError`로 거부.
"멀티룸 미지원"을 조용한 버그 대신 명시적 에러로 전환.

## 변경 범위

| 파일 | 변경 내용 |
|------|----------|
| `src/waiting-room/waiting-room.service.ts` | register()를 ZADD NX로 교체, roomId 검증 추가, verifyToken() 메서드 추가 |
| `src/waiting-room/waiting-room.controller.ts` | `POST /rooms/:roomId/waiting-users/verify` 엔드포인트 추가 |
| `src/waiting-room/admission.service.ts` | Promise.allSettled + 실패 멤버 재등록 로직 |
| `src/waiting-room/dto/verify-token.dto.ts` | 신규. `{ token: string }` 요청 DTO |
| `src/waiting-room/dto/waiting-status.dto.ts` | `VerifyTokenResultDto` 타입 추가 |
| `services/waiting-room/ARCHITECTURE.md` | API 표에 verify 엔드포인트 추가, 설계 결정에 이번 수정 반영 |

## 영향성

| 영향 대상 | 영향 내용 |
|-----------|----------|
| `panel.html` | 변경 없음 (기존 register/status 응답 포맷 그대로 유지) |
| `dashboard` | 변경 없음 |
| node-forge | 코드 수정 없음. `getClient()`로 이미 제공되는 탈출구만 사용 |
| 기존 API 응답 포맷 | `register()` 성공 응답(`position`, `queueLength`)은 동일하게 유지 (내부 구현만 원자적으로 교체) |

## Breaking Changes

없음. 응답 포맷과 기존 엔드포인트 동작은 그대로 유지하고, 새 엔드포인트(verify)만 추가되며
버그였던 동작(레이스 컨디션, 조용한 기아)만 명시적으로 고쳐진다.

## 위험도

**MEDIUM** — 단일 서비스 내부 로직 변경이라 다른 서비스에 영향 없지만, `register()`의
핵심 쓰기 경로를 바꾸는 거라 동시성 테스트로 실제 검증이 필요함.

## 주의사항

- `getClient().zadd(key, "NX", score, member)`는 ioredis 원시 API라 `ForgeRedisClient`의
  직렬화 규약(다른 메서드들의 JSON 래핑)과 무관하다 — member는 그냥 문자열 그대로 저장되므로
  기존 `zscore`/`zrank`/`zcard` 등 다른 zset 메서드와 완전히 호환된다 (같은 원시 ZSET을 씀).
- admission 실패 시 재등록하는 score는 **원래 등록 시각**을 그대로 써야 한다 (재등록 시점의
  `Date.now()`를 쓰면 대기 순번이 맨 뒤로 밀려서 불공평해짐).
- roomId 검증을 register()에만 넣고 getStatus/getOverview에는 넣지 않는다 — 조회는 굳이 막을
  이유가 없고(어차피 빈 결과), 등록만 막으면 애초에 그 room에 유저가 쌓일 일이 없다.

## 작업 단계

### 1단계: register() 원자적 중복 방지 + room 검증

1. `waiting-room.service.ts`의 `register()`를 `ZADD NX` 방식으로 교체
2. `roomId !== ADMISSION_ROOM_ID` 검증 추가 (register 진입 시점)
3. 로컬 빌드 확인

### 2단계: 토큰 검증 엔드포인트

1. `dto/verify-token.dto.ts` 작성
2. `waiting-room.service.ts`에 `verifyToken(roomId, token)` 추가 (서명 검증 + Redis 대조)
3. `waiting-room.controller.ts`에 `POST /rooms/:roomId/waiting-users/verify` 추가
4. 로컬 빌드 확인

### 3단계: admission 부분 실패 복구

1. `admission.service.ts`의 `Promise.all` → `Promise.allSettled` + 실패 멤버 재등록
2. 로컬 빌드 확인

### 4단계: 통합 검증

1. Docker로 재기동
2. 동시 등록 테스트(같은 userId로 병렬 curl)로 레이스 컨디션이 실제로 막히는지 확인
3. verify 엔드포인트 정상/비정상 토큰 케이스 확인
4. 다른 roomId 등록 시도 시 명시적 에러 확인
5. `ARCHITECTURE.md` 갱신

## 검증 방법

1. `curl`로 같은 userId 동시 등록 10회(`&` 백그라운드 병렬) → 성공 1건, 나머지 9건 전부 `E9409`인지 확인 (기존엔 여러 건이 성공하거나 순번이 덮어써질 수 있었음)
2. admission 후 발급된 토큰으로 `POST .../verify` → `valid: true`, 없는/조작된 토큰으로는 `valid: false`
3. `curl -X POST .../rooms/other-room/waiting-users` → 명시적 에러 응답 (기존엔 201 성공했었음)
4. 기존 waiting/admitted/overview/reset 흐름이 전부 그대로 동작하는지 회귀 확인

## 참조 규칙

- `.claude/rules/common/principles.md` — 임의 확장 금지(멀티룸 실제 구현 대신 명시적 거부로 처리)
- `.claude/rules/common/workflow.md` — node-forge 부족 기능 발견 시 제안서 먼저 (이번엔 `getClient()` 탈출구로 해결되어 제안서 불필요)
