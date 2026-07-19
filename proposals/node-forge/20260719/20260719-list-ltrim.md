# node-forge 제안 — `ForgeRedisClient`에 `ltrim` 추가

## 계기

`services/live-ranking`에서 DLQ로 넘어간 이벤트를 사람이 볼 수 있게 Redis LIST에 기록하는
`DlqLogService`를 만들면서, "최근 N개만 유지"하는 패턴을 완전하게 구현할 수 없었다.

```ts
// dlq-log.service.ts
async record(entry: DlqLogEntry): Promise<void> {
  await this.redis.lpush(DLQ_LOG_KEY, entry);
  // 여기서 오래된 항목을 잘라내고 싶지만 ltrim이 없어서 못 함
}

async getOverview(): Promise<DlqOverview> {
  const [count, recent] = await Promise.all([
    this.redis.llen(DLQ_LOG_KEY),                              // 전체 개수는 계속 늘어남
    this.redis.lrange<DlqLogEntry>(DLQ_LOG_KEY, 0, DLQ_LOG_LIMIT - 1), // 조회할 때만 앞쪽 N개만 봄
  ]);
  return { count, recent };
}
```

리스트 자체는 계속 자라고, 조회할 때만 앞쪽 일부를 보는 식으로 우회했다. 랩 환경에서
당장 문제는 아니지만, "최근 활동 로그", "최근 에러 N개" 같은 흔한 Redis 패턴을 node-forge로
완전하게 구현할 수 없다는 게 아쉬웠다.

## 현재 한계

`ForgeRedisClient`의 List 섹션에 `lpush`/`rpush`/`lpop`/`rpop`/`lrange`/`llen`은 있는데
`LTRIM`을 감싸는 메서드가 없다.

## 제안

```ts
/**
 * @description 리스트를 start~stop 인덱스 범위만 남기고 나머지를 제거한다(Redis LTRIM).
 * "최근 N개만 유지" 패턴에서 lpush 뒤에 호출해 무한히 자라는 걸 막는 용도로 쓴다.
 */
async ltrim(key: string, start: number, stop: number): Promise<void> {
  await this.client.ltrim(key, start, stop);
}
```

사용 예:

```ts
async record(entry: DlqLogEntry): Promise<void> {
  await this.redis.lpush(DLQ_LOG_KEY, entry);
  await this.redis.ltrim(DLQ_LOG_KEY, 0, DLQ_LOG_LIMIT - 1); // 최근 N개만 물리적으로 유지
}
```

## 검증 포인트

- `lpush`로 N+5개를 넣고 `ltrim(key, 0, N-1)`을 호출하면 `llen`이 정확히 N이 되는지
- `ltrim` 이후 `lrange(key, 0, -1)`이 가장 최근에 넣은 N개만(순서 유지) 반환하는지
- 존재하지 않는 키에 `ltrim`을 호출해도 에러 없이 조용히 무시되는지(Redis 네이티브 동작과 동일)

## 기각한 대안

- **애플리케이션 코드에서 `lrange`로 다 가져온 뒤 `del`+`rpush`로 다시 채우기**: 왕복이
  늘고 원자적이지 않다(그 사이 다른 프로세스가 lpush하면 유실 가능). `LTRIM`은 Redis
  서버 안에서 원자적으로 끝나는 훨씬 가벼운 해결책이다.
