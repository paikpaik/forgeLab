# node-forge 제안 — `ForgeRedisClient.zadd`에 NX/XX 옵션 추가

## 계기

`services/waiting-room`의 대기열 등록(`register()`)에 "같은 유저가 동시에 여러 번 등록 요청을
보내도 딱 한 번만 성공해야 한다"는 요구사항이 있었다. 처음엔 아래처럼 구현했다.

```ts
const existing = await this.redis.zscore(key, userId);
if (existing !== null) throw new ForgeBizError("E9409", "이미 대기 중인 사용자입니다");
await this.redis.zadd(key, [{ score: Date.now(), member: userId }]);
```

실제로 같은 userId로 10개 동시 요청을 보내보니 `zscore`(조회)와 `zadd`(쓰기)가 별개의 Redis
왕복이라 그 사이에 다른 요청이 끼어들 수 있었다 — 여러 요청이 전부 "없음"을 보고 통과해버려서
중복 방지가 깨졌다(TOCTOU). 대기열 서비스의 핵심 정합성 문제였다.

## 현재 한계

`ForgeRedisClient.zadd`의 시그니처는 다음과 같다.

```ts
async zadd(key: string, entries: { score: number; member: string }[]): Promise<number>
```

Redis 네이티브 `ZADD` 명령은 `NX`(member가 없을 때만 추가) / `XX`(member가 있을 때만 갱신) /
`GT`/`LT`(기존 score보다 크거나/작을 때만 갱신) / `CH`(변경된 개수 반환) 옵션을 지원하는데,
`ForgeRedisClient.zadd`는 이 중 어떤 것도 받지 못한다. 그래서 "조회 후 조건부 쓰기"가
필요한 경우 `zscore`+`zadd` 두 단계로 쪼갤 수밖에 없고, 그 사이에 항상 레이스 컨디션 여지가
생긴다.

## 우회 (지금 임시로 쓰고 있는 방법)

`getClient()`로 raw ioredis 인스턴스를 꺼내서 네이티브 옵션을 직접 넘긴다.

```ts
const added = await this.redis.getClient().zadd(key, "NX", Date.now(), userId);
if (added === 0) throw new ForgeBizError("E9409", "이미 대기 중인 사용자입니다");
```

동작은 하지만, `ForgeRedisClient`가 제공하는 다른 zset 메서드들과 스타일이 안 맞고
(직렬화·에러 처리 등 wrapper의 일관성을 못 받음), `zadd`라는 같은 이름의 메서드를 두 가지
다른 방식(wrapped/raw)으로 섞어 쓰게 되어 코드 일관성이 떨어진다.

## 제안

`zadd`에 세 번째 옵션 인자를 추가한다.

```ts
async zadd(
  key: string,
  entries: { score: number; member: string }[],
  options?: { mode?: "NX" | "XX"; ch?: boolean },
): Promise<number>
```

- `mode: "NX"` — member가 없을 때만 추가 (이번 케이스가 필요로 하는 것)
- `mode: "XX"` — member가 있을 때만 갱신
- `ch` — 반환값을 "추가된 개수"가 아니라 "변경된 개수"(추가+갱신)로

`entries`가 여러 개余도 한 번에 처리 가능해야 하므로(기존 시그니처와의 호환성), NX/XX는
Redis 명령어 자체가 그렇듯 전체 호출에 한 번만 적용되는 걸로 설계한다.

## 검증 포인트

- `zadd(key, [{score, member}], { mode: "NX" })`를 동시에 여러 번 호출했을 때 정확히 한 번만
  1을 반환하고 나머지는 0을 반환하는지 (동시성 유닛테스트 또는 `Promise.all`로 같은 member를
  여러 번 등록 시도)
- 기존 `zadd(key, entries)`(옵션 생략) 호출이 지금과 동일하게 동작하는지 (하위 호환성)

## 기각한 대안

- **`withLock`으로 감싸기**: `redis.withLock(key, ttl, async () => { zscore + zadd })`도
  가능하지만, 분산 락 획득/해제 왕복이 추가되어 `ZADD NX` 한 번보다 느리고, 락 TTL 설정·재시도
  정책까지 신경 써야 해서 이 문제엔 과한 해법이다. `ZADD NX`가 Redis 서버 안에서 원자적으로
  끝나는 훨씬 가벼운 해결책이다.
