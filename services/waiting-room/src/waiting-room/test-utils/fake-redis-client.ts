/**
 * ForgeRedisClient가 지원하는 메서드 중 waiting-room이 실제로 쓰는 것만 인메모리로
 * 구현한 fake. 실제 Redis 없이도 zadd NX, zrangeWithScores+zrem 순서, TTL 만료 같은
 * 진짜 동작을 검증할 수 있다 (kafka-forge가 kafkajs를 fake하는 것과 같은 패턴).
 */
export class FakeRedisClient {
  private readonly zsets = new Map<string, Map<string, number>>();
  private readonly strings = new Map<string, { value: unknown; expiresAt: number | null }>();

  private zset(key: string): Map<string, number> {
    let z = this.zsets.get(key);
    if (!z) {
      z = new Map();
      this.zsets.set(key, z);
    }
    return z;
  }

  private sorted(key: string): { member: string; score: number }[] {
    return [...this.zset(key).entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([member, score]) => ({ member, score }));
  }

  async zadd(
    key: string,
    entries: { score: number; member: string }[],
    options?: { mode?: "NX" | "XX"; ch?: boolean },
  ): Promise<number> {
    const z = this.zset(key);
    let count = 0;
    for (const { score, member } of entries) {
      const exists = z.has(member);
      if (options?.mode === "NX" && exists) continue;
      if (options?.mode === "XX" && !exists) continue;
      const changed = !exists || z.get(member) !== score;
      z.set(member, score);
      if (!exists || (options?.ch && changed)) count++;
    }
    return count;
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    const z = this.zset(key);
    let count = 0;
    for (const member of members) {
      if (z.delete(member)) count++;
    }
    return count;
  }

  async zscore(key: string, member: string): Promise<number | null> {
    const z = this.zset(key);
    return z.has(member) ? (z.get(member) as number) : null;
  }

  async zrank(key: string, member: string): Promise<number | null> {
    const index = this.sorted(key).findIndex((entry) => entry.member === member);
    return index === -1 ? null : index;
  }

  async zcard(key: string): Promise<number> {
    return this.zset(key).size;
  }

  async zrangeWithScores(
    key: string,
    start: number,
    stop: number,
  ): Promise<{ member: string; score: number }[]> {
    const all = this.sorted(key);
    const end = stop === -1 ? all.length : stop + 1;
    return all.slice(start, end);
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.strings.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      this.strings.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set(key: string, value: unknown, expireSeconds?: number): Promise<void> {
    const expiresAt = expireSeconds !== undefined ? Date.now() + expireSeconds * 1000 : null;
    this.strings.set(key, { value, expiresAt });
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.zsets.delete(key)) count++;
      if (this.strings.delete(key)) count++;
    }
    return count;
  }

  async scanKeys(pattern: string): Promise<string[]> {
    const regex = new RegExp(
      "^" +
        pattern
          .split("*")
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*") +
        "$",
    );
    return [...this.strings.keys()].filter((key) => regex.test(key));
  }
}
