// ForgeRedisClient의 실제 구현(redis.ts)은 hset/hmset/hgetall에서 값을 JSON.stringify/parse로
// 직렬화한다(단순 String() 변환이 아니다) — 그래서 null은 실제로 null로, 숫자는 숫자로
// 정확히 왕복 복원된다. 이 fake도 실제 동작과 다르면(예: String(null) === "null"이 truthy로
// 오판되는 등) node-forge의 DistributedCircuitBreaker 로직이 실제 Redis에서와 다르게
// 동작하는 걸 놓치게 되므로, JSON 직렬화까지 정확히 흉내낸다.
export class FakeRedisClient {
  private readonly hashes = new Map<string, Map<string, string>>();

  async hgetall<T>(key: string): Promise<Record<string, T> | null> {
    const hash = this.hashes.get(key);
    if (!hash || hash.size === 0) return null;
    return Object.fromEntries(
      [...hash.entries()].map(([field, raw]) => [field, JSON.parse(raw) as T]),
    );
  }

  async hmset(key: string, data: Record<string, unknown>): Promise<void> {
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    for (const [field, value] of Object.entries(data)) {
      hash.set(field, JSON.stringify(value));
    }
    this.hashes.set(key, hash);
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    const current = hash.has(field) ? (JSON.parse(hash.get(field)!) as number) : 0;
    const next = current + increment;
    hash.set(field, JSON.stringify(next));
    this.hashes.set(key, hash);
    return next;
  }
}
