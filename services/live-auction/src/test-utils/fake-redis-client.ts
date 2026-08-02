// AuctionService가 실제로 쓰는 4개 메서드(get/set/publish/withLock)만 흉내낸다.
// withLock은 진짜 Redis 분산 락처럼 "같은 key는 직렬화, 다른 key는 동시 실행"을 재현해야
// 동시 입찰 레이스 테스트가 의미를 가진다 — 단순히 즉시 fn을 실행하면 lost update 버그가
// 있어도 테스트가 못 잡는다.
export class FakeRedisClient {
  private readonly store = new Map<string, unknown>();
  private readonly locks = new Map<string, Promise<void>>();

  async get<T>(key: string): Promise<T | null> {
    return this.store.has(key) ? (this.store.get(key) as T) : null;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }

  async publish(_channel: string, _value: unknown): Promise<number> {
    return 0;
  }

  subscribe(_channel: string, _handler: (value: unknown) => void): void {
    // 유닛 테스트에서는 AuctionGateway를 안 띄우므로 구독자가 없다 — no-op.
  }

  async withLock<T>(key: string, _ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, next);
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
