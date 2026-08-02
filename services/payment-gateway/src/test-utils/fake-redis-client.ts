// DistributedCircuitBreaker가 실제로 쓰는 3개 메서드(hmset/hgetall/hincrby)만 흉내낸다.
// 진짜 ForgeRedisClient 대신 이 페이크를 넣어도 DistributedCircuitBreaker 클래스 자체는
// 실제 프로덕션 코드 그대로 쓰기 때문에, 회로 상태 전이 로직을 목(mock) 없이 검증할 수 있다.
export class FakeRedisClient {
  private readonly hashes = new Map<string, Record<string, unknown>>();

  async hmset(key: string, data: Record<string, unknown>): Promise<void> {
    const current = this.hashes.get(key) ?? {};
    this.hashes.set(key, { ...current, ...data });
  }

  async hgetall<T>(key: string): Promise<Record<string, T> | null> {
    const current = this.hashes.get(key);
    return current ? (current as Record<string, T>) : null;
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    const current = this.hashes.get(key) ?? {};
    const next = Number(current[field] ?? 0) + increment;
    this.hashes.set(key, { ...current, [field]: next });
    return next;
  }
}
