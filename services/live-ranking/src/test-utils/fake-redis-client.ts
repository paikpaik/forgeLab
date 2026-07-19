// ForgeRedisClient의 실제 구현은 내부 ioredis 클라이언트(this.client)를 통해 getTopN/
// getRankAndScore/zincrby 등을 처리한다. RankingService/RedisIdempotencyStore는 그 공개
// 메서드만 호출하므로, 여기서는 ioredis를 흉내내는 대신 공개 메서드 자체를 인메모리로
// 다시 구현한다 (waiting-room의 FakeRedisClient와 동일한 패턴).
export class FakeRedisClient {
  private readonly zsets = new Map<string, Map<string, number>>();
  private readonly strings = new Map<string, { value: string; expiresAt: number | null }>();
  private readonly lists = new Map<string, unknown[]>();

  async zincrby(key: string, member: string, increment: number): Promise<number> {
    const zset = this.zsets.get(key) ?? new Map<string, number>();
    const next = (zset.get(member) ?? 0) + increment;
    zset.set(member, next);
    this.zsets.set(key, zset);
    return next;
  }

  async getTopN(
    key: string,
    n: number,
  ): Promise<{ member: string; score: number; rank: number }[]> {
    const zset = this.zsets.get(key) ?? new Map<string, number>();
    return [...zset.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([member, score], index) => ({ member, score, rank: index + 1 }));
  }

  async getRankAndScore(
    key: string,
    member: string,
  ): Promise<{ rank: number | null; score: number | null }> {
    const zset = this.zsets.get(key) ?? new Map<string, number>();
    if (!zset.has(member)) return { rank: null, score: null };
    const sorted = [...zset.entries()].sort((a, b) => b[1] - a[1]);
    const rank = sorted.findIndex(([m]) => m === member) + 1;
    return { rank, score: zset.get(member) as number };
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.zsets.delete(key)) count++;
      if (this.strings.delete(key)) count++;
      if (this.lists.delete(key)) count++;
    }
    return count;
  }

  async lpush(key: string, ...values: unknown[]): Promise<number> {
    const list = this.lists.get(key) ?? [];
    list.unshift(...values.slice().reverse());
    this.lists.set(key, list);
    return list.length;
  }

  async lrange<T>(key: string, start: number, stop: number): Promise<T[]> {
    const list = this.lists.get(key) ?? [];
    const end = stop === -1 ? list.length : stop + 1;
    return list.slice(start, end) as T[];
  }

  async llen(key: string): Promise<number> {
    return (this.lists.get(key) ?? []).length;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.strings.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      this.strings.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.strings.set(key, { value, expiresAt });
  }

  // 실제 구현(SET NX PX)과 동일한 시맨틱만 흉내낸다 — 이미 있으면 null, 없으면 토큰 발급 후 저장.
  async lock(key: string, ttlSeconds: number): Promise<string | null> {
    if ((await this.get(key)) !== null) return null;
    const token = Math.random().toString(36).slice(2);
    await this.set(key, token, ttlSeconds);
    return token;
  }
}
