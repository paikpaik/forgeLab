## 플랜 실행 이력

### 완료: 2026-07-17

**결과**: 성공 (4단계 전부 완료 + 검증)

**실제 변경 파일**:
- `src/waiting-room/waiting-room.constants.ts` — `admissionLogKey()`, `ADMISSION_LOG_TTL_SECONDS` 추가
- `src/waiting-room/waiting-room.service.ts` — `getStatus()`에 `expired` 분기, `reset()`에서 admission-log도 정리
- `src/waiting-room/admission.service.ts` — `zpopmin` → `zrangeWithScores`(peek)+`zrem`(성공분만 커밋)으로 재설계, admission-log 기록 추가. 계획에 있던 "실패 시 zadd로 재등록" 로직은 이 재설계로 불필요해져서 제거
- `src/waiting-room/dto/waiting-status.dto.ts` — `{ status: "expired" }` 추가
- `src/waiting-room/test-utils/fake-redis-client.ts`, `token.service.test.ts`, `waiting-room.service.test.ts`, `admission.service.test.ts` — 신규 (18개 테스트)
- `vitest.config.ts`, `package.json`(test 스크립트, vitest devDependency), `tsconfig.json`(테스트 파일 빌드 제외) — 신규/수정
- `public/panel.html` — 내 티켓에 `expired` 상태 표시 추가, 버스트 시뮬레이션에 "중지" 버튼(예약된 setTimeout 취소 + AbortController로 진행 중 요청 중단)
- `ARCHITECTURE.md` — 다이어그램/API/Redis 키 스키마/설계 결정 갱신

**계획과의 차이**:
- 2단계: 계획에는 "zpopmin 유지 + 실패 시 재등록"이었는데, 구현하면서 아예 `zpopmin`을 안 쓰고 조회(peek)만 하다가 성공한 것만 마지막에 지우는 방식으로 재설계함 — 재등록 로직 자체가 필요 없어져서 더 단순해짐 (강제 종료에도 완전히 안전)
- 4단계: AbortController로 "이미 나간 요청"까지 중단 시도하는 부분은 계획에 명시 안 돼 있었지만, "예약된 요청만 취소"로는 불충분하다고 판단해 추가

**검증 결과**:
1. TTL을 3초로 낮춰서 실제로 admitted → expired → not_found 3단계 전환 확인 (한 번도 등록 안 한 유저는 여전히 not_found)
2. 30명 버스트 등록 후 2초 배치 주기로 30→20→10→0 정상 드레인 확인 (재설계 후에도 동일)
3. `npm test` — 18개 테스트 전부 통과 (중복 등록 방지, verify 성공/실패, expired 분기, admission 부분 실패 시 대기열 잔류까지 포함)
4. reset이 admission-log까지 지우는지 확인
5. panel.html의 script 블록 `node --check`로 문법 검증
6. Docker 전체 재빌드 + health/panel.html 서빙 최종 확인

**잔존 작업**:
- 나머지 MEDIUM/LOW(Redis 볼륨, reset 보호, 기본 시크릿, rate limit 등)는 "배포 안 할 것"이라는 사용자 판단에 따라 여전히 스코프 아웃

### 후속: 2026-07-17 (같은 날, "중지" 버튼의 실제 의미 재정의)

배포 후 사용자가 "중지를 눌러도 대기열이 계속 admission을 기다려야 한다"고 피드백함 — 4단계에서
만든 중지 버튼은 **등록(버스트) 요청**만 취소했을 뿐, 사용자가 실제로 답답해했던 지점은
**admission이 5초마다 10명씩만 처리되는 배치 대기**였다. 둘은 서로 다른 파이프라인 단계라
중지 버튼이 원하는 문제를 전혀 못 풀었음.

처음엔 "즉시 전체 admission 처리"(admitAll)로 풀려고 했으나, 사용자가 "그건 부하를 그대로
가져가는 거고, 나는 그냌 중단을 원한다"고 정정 — 즉 "빨리 끝내기"가 아니라 "하던 걸 취소하고
없애기"를 원했음. 추가 확인 결과 "이미 등록된 사람도 대기열에서 지워야 한다"로 확정.

**실제 변경**:
- `waiting-room.service.ts` — `removeUsers(roomId, userIds)` 추가 (지정한 userId만 `zrem`,
  `reset()`과 달리 전체를 지우지 않아서 "내 티켓"으로 등록한 건 안 건드림)
- `dto/remove-waiting-users.dto.ts` — 신규
- `waiting-room.controller.ts` — `POST /rooms/:roomId/waiting-users/remove` 추가
- `waiting-room.service.test.ts` — `removeUsers` 테스트 2건 추가 (지정한 것만 지움, 이미 없는 것도 안전)
- `public/panel.html` — `stopBurst()`가 타이머 취소/요청 abort 후 `/remove`를 호출해서 이 버스트가
  등록한(응답 확인 여부와 무관하게 스케줄된 전체) userId를 대기열에서 정리
- `ARCHITECTURE.md` — API 표에 `remove` 추가

**검증**: 3명 등록(2명은 "버스트", 1명은 "내 티켓" 흉내) → `remove`로 버스트 2명만 지정 →
정확히 그 2명만 사라지고 나머지 1명은 그대로 남는 것 확인 (curl). 테스트 20개 전부 통과,
Docker 재빌드 후 실제 서빙되는 panel.html에 반영 확인.

---

### 후속 2: 2026-07-17 (버튼이 등록 완료 즉시 숨어버리는 문제)

위 수정을 실제로 반영한 뒤에도 사용자가 "지금도 전체 대기열이 끝날때까지 기다려야하는데?"라고
재현 — `/remove` 자체는 정상 동작하는데, 정작 그걸 호출할 버튼이 사라져 있었음. 원인은
`panel.html`의 `runBurst()`가 등록 요청이 전부 끝나면(`state.done === count`) 곧바로
`burstState = null; setBurstRunning(false)`를 호출해 버튼을 숨기는 코드였음 — 등록 자체는
몇 초 안에 끝나지만 admission은 5초 간격 배치라 그 사이 구간에는 중지(=제거)할 방법이
없어져서, 결과적으로 admission이 다 처리할 때까지 기다리는 것과 똑같아짐.

**실제 변경**: `public/panel.html`만 수정.
- `runBurst()` — 등록 완료 `.finally()`에서 `burstState`/`setBurstRunning`을 더 이상 건드리지
  않음. 대신 버튼 라벨을 "중지" → "대기열에서 빼기"로 바꿔서 역할이 바뀌었음을 표시하고, 버튼은
  계속 떠 있게 함.
- `stopBurst()`는 그대로 두되(타이머/컨트롤러가 이미 비어 있어도 안전하게 no-op), 실제로 눌렀을
  때만 `burstState = null; setBurstRunning(false)`로 숨김.
- 다음 버스트 시작 시 버튼 라벨을 "중지"로 리셋.
- "테스트 방법" 가이드에 이 동작을 설명하는 항목 추가.

**검증**: curl로 3명(+내 티켓 1명) 등록 후 등록이 "완료된" 상태에서도(즉 registration 루프가 끝난
뒤) `/remove`가 여전히 정확하게 지정된 3명만 제거하는 것을 재확인. Docker 재빌드 후 실제
서빙되는 panel.html에 `"대기열에서 빼기"` 문자열이 포함된 것 확인.

**잔존**: 버튼을 "자동으로" 숨기는 기능(admission이 자연히 다 드레인되면 알아서 숨기기)은
구현하지 않음 — 전체 대기열 중 이 버스트가 등록한 사람이 몇 명 남았는지 확인하려면 별도
멤버십 조회 API가 필요해서, 지금 스코프에서는 사용자가 "중지"를 누르거나 "초기화"할 때만
버튼이 사라지는 수동 방식으로 남겨둠.

---

# waiting-room-remaining-fixes — TTL 만료 상태 구분, admission 강제종료 대비, 테스트, 버스트 중지 버튼

## 목표

이전 냉정한 분석에서 남겨뒀던 두 가지 기능적 문제(admitted TTL 만료 후 상태 혼동, admission
도중 프로세스 강제 종료 시 유저 유실 가능성)를 고치고, 회귀를 잡을 수 있는 최소한의 테스트를
추가한다. 추가로 panel.html의 버스트 시뮬레이션에 "중지" 버튼을 붙여서, 테스트하다가 중간에
멈추고 다시 시작할 수 있게 한다. 배포/보안 관련 항목(Redis 볼륨, reset 보호, 기본 시크릿,
rate limit)은 "실제 배포 안 할 것"이라는 사용자 판단에 따라 이번에도 다루지 않는다.

## 현재 상태 (AS-IS)

**1. TTL 만료 후 상태 혼동** — `getStatus()`는 `admittedKey` TTL(5분) 만료 후엔 `zrank`도
`null`이라 `not_found`를 반환한다. "한 번도 등록 안 한 사람"과 "입장 기회를 놓친 사람"이
API 응답상 구분 불가능.

**2. admission 도중 프로세스가 죽으면 유저 유실 가능** — 현재 `runAdmission()`은
`zpopmin`으로 먼저 대기열에서 제거(커밋)한 뒤 토큰을 저장한다. `redis.set()`이 에러를
던지는 경우는 재등록 로직으로 커버했지만, **프로세스 자체가 그 사이에 강제 종료**(SIGKILL,
전원 차단 등)되면 재등록 코드도 실행되지 못해 유저가 사라진다.

**3. 테스트 코드 없음** — `waiting-room`에는 `test` 스크립트도, vitest 설정도 없다.

**4. 버스트 시뮬레이션 중지 불가** — `panel.html`의 `runBurst()`는 `Promise.allSettled`로
모든 요청을 한 번에 스케줄해버려서, 실행 중간에 멈출 방법이 없다. 잘못된 인원수를 넣고
시작했거나 중간 상태를 확인하고 싶어도 끝까지 기다려야 한다.

## 변경 후 상태 (TO-BE)

**1.** admission 시 토큰(`admittedKey`, TTL 5분)과 별개로, 더 긴 TTL(1시간)을 가진
"admission 기록"(`admissionLogKey`)을 같이 남긴다. `getStatus()`는 순서대로
`admitted 토큰 있음` → `대기열에 있음` → `admission 기록만 있음(=expired)` → `not_found`로
판정한다.

**2.** `zpopmin`(먼저 제거) 대신 `zrangeWithScores`로 **먼저 조회만**(부작용 없음) 하고,
토큰 발급이 실제로 성공한 멤버만 마지막에 `zrem`으로 제거한다. 이러면 그 사이에 프로세스가
어떤 방식으로 죽어도 — 에러든 강제 종료든 — 아직 못 지운 멤버는 대기열에 그대로 남아있어서
다음 주기에 자동으로 다시 시도된다 (peek이라 부작용 없고, 단일 인스턴스 전제라 재시도해도
안전). 기존의 "실패 시 재등록" 로직은 이 재설계로 자연스럽게 필요 없어진다.

**3.** vitest 도입(node-forge/kafka-forge와 동일 도구). `token.service`, `waiting-room.service`,
`admission.service`의 핵심 분기(중복 등록 방지, verify 성공/실패, TTL 만료 상태, admission
부분 실패 시 재시도)를 유닛테스트로 커버한다. `ForgeRedisClient`는 fake 객체로 대체.

**4.** panel.html에 "중지" 버튼 추가. 예약된(아직 안 쏜) 요청은 `clearTimeout`으로 취소,
이미 나간 요청은 `AbortController`로 중단 시도. 중지해도 이미 등록된 사람은 그대로 유지되고,
"몇 명 처리했는지"는 로그에 남는다.

## 변경 범위

| 파일 | 변경 내용 |
|------|----------|
| `src/waiting-room/waiting-room.constants.ts` | `admissionLogKey()`, `ADMISSION_LOG_TTL_SECONDS` 추가 |
| `src/waiting-room/waiting-room.service.ts` | `getStatus()`에 `expired` 분기 추가, `reset()`에서 admission-log 키도 정리 |
| `src/waiting-room/admission.service.ts` | `zpopmin` → `zrangeWithScores`+`zrem`(성공분만) 재설계, admission-log 기록 추가 |
| `src/waiting-room/dto/waiting-status.dto.ts` | `WaitingStatusDto`에 `{ status: "expired" }` 추가 |
| `public/panel.html` | "내 티켓" expired 상태 표시, 버스트 중지 버튼/로직 추가 |
| `package.json` | `vitest` devDependency, `test` 스크립트 추가 |
| `vitest.config.ts` | 신규 |
| `src/waiting-room/*.test.ts` | 신규 (token/service/admission 테스트) |
| `ARCHITECTURE.md` | Redis 키 스키마에 admission-log 추가, 설계 결정 갱신 |

## 영향성

| 영향 대상 | 영향 내용 |
|-----------|----------|
| 기존 API 응답 포맷 | `waiting`/`admitted`/`not_found`는 그대로, `expired`만 새로 추가(하위 호환) |
| dashboard | 변경 없음 |
| node-forge | 코드 수정 없음. 기존 `zrangeWithScores`/`zrem`/`set`/`get` 그대로 사용 |

## Breaking Changes

없음. `WaitingStatusDto`에 새 variant가 추가되지만 기존 클라이언트가 처리 안 해도(모르는
status 값 무시) 크래시 나지 않는다.

## 위험도

**MEDIUM** — admission 로직 재설계(2번)가 핵심 경로라 실제 curl 검증 필요. 나머지는 추가/보강 성격.

## 주의사항

- `zrangeWithScores`로 peek한 뒤 `zrem`하는 사이에 다른 곳(예: 수동 `reset()`)이 같은 멤버를
  건드려도, `zrem`은 존재하지 않는 멤버에 대해 그냥 무시하므로(에러 안 남) 안전하다.
- admission-log 키는 "입장 허용됐었다는 사실"만 기록하는 용도라, 실제 접근 권한 판단(`verifyToken`)에는
  절대 쓰지 않는다 — 권한 판단은 여전히 TTL이 짧은 `admittedKey` 기준.
- vitest는 devDependency로만 추가하고 런타임 이미지(Dockerfile)에는 영향 없어야 한다
  (`npm install --omit=dev`가 이미 vitest를 빼줌).

## 작업 단계

### 1단계: TTL 만료 상태 구분

1. `waiting-room.constants.ts`에 `admissionLogKey`, `ADMISSION_LOG_TTL_SECONDS` 추가
2. `waiting-status.dto.ts`에 `expired` variant 추가
3. `waiting-room.service.ts`의 `getStatus()`/`reset()` 수정
4. `admission.service.ts`에서 admission-log 기록 추가 (2단계와 함께 진행)

### 2단계: admission 강제종료 대비 재설계

1. `admission.service.ts`의 `runAdmission()`을 zpopmin → zrangeWithScores+zrem(성공분만) 방식으로 재작성
2. 로컬/Docker로 재기동, curl로 정상 admission 동작 확인
3. (재현이 번거로우면) 코드 리뷰로 "커밋 시점이 항상 부작용 이후"인지 재확인

### 3단계: 테스트 추가

1. vitest 설치, `vitest.config.ts` 작성
2. `token.service.test.ts` — issue/verify 라운드트립, 변조 토큰 거부
3. `waiting-room.service.test.ts` — 중복 등록 방지(NX 반환값 0), verify 성공/실패, expired 분기
4. `admission.service.test.ts` — 정상 처리, 부분 실패 시 해당 멤버만 zrem 안 됨(대기열 잔류)
5. `npm test` 통과 확인

### 4단계: 버스트 중지 버튼

1. `panel.html`에 "중지" 버튼 추가 (실행 중에만 노출)
2. `runBurst()`를 취소 가능한 구조로 재작성 (setTimeout 핸들 + AbortController 추적)
3. `stopBurst()` 구현 — 예약된 타이머 정리 + 진행 중 요청 abort + 로그에 중단 시점까지 처리된 수 기록
4. 브라우저 대신 curl로 API 흐름은 그대로임을 재확인 (이 변경은 순수 프론트엔드)

## 검증 방법

1. admission 후 5분(TTL) 넘겨서(또는 TTL을 짧게 낮춰서 테스트) 상태 조회 → `expired` 응답 확인
2. admission 로직 재설계 후 정상 케이스가 기존과 동일하게 동작하는지 (등록→admission→상태 변화)
3. `npm test` 전부 통과
4. panel.html에서 버스트 시작 후 "중지" 클릭 → 이후 카운트가 안 늘어나는지, 이미 등록된 사람 수는 유지되는지

## 참조 규칙

- `.claude/rules/common/principles.md` — 배포/보안 항목은 이번에도 스코프 아웃 (사용자 명시적 판단)
