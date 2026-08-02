type Behavior =
  | { kind: "resolve"; data: unknown }
  | { kind: "reject-response"; status: number }
  | { kind: "reject-no-response" };

// ForgeHttpClient가 실제로 쓰이는 자리에 대신 넣는 페이크 — PaymentService는 .post/.get만
// 쓰므로 그 둘만 흉내낸다. 응답이 있는 실패(.response 존재)와 응답 자체가 없는 실패(타임아웃/
// 커넥션 에러, .response 없음)를 구분해서 큐에 넣을 수 있어야 IN_DOUBT/FAILED 분기를
// 각각 검증할 수 있다.
export class FakeHttpClient {
  private readonly postQueue: Behavior[] = [];
  private readonly getQueue: Behavior[] = [];
  postCallCount = 0;
  getCallCount = 0;

  queuePostResolve(data: unknown): void {
    this.postQueue.push({ kind: "resolve", data });
  }

  queuePostRejectResponse(status: number): void {
    this.postQueue.push({ kind: "reject-response", status });
  }

  queuePostRejectNoResponse(): void {
    this.postQueue.push({ kind: "reject-no-response" });
  }

  queueGetResolve(data: unknown): void {
    this.getQueue.push({ kind: "resolve", data });
  }

  async post<T>(_url: string, _data?: unknown): Promise<T> {
    this.postCallCount += 1;
    return this.resolve(this.postQueue) as T;
  }

  async get<T>(_url: string): Promise<T> {
    this.getCallCount += 1;
    return this.resolve(this.getQueue) as T;
  }

  private resolve(queue: Behavior[]): unknown {
    const behavior = queue.shift() ?? { kind: "resolve" as const, data: {} };
    if (behavior.kind === "resolve") return behavior.data;
    if (behavior.kind === "reject-response") {
      const err = new Error(`HTTP ${behavior.status}`) as Error & { response: { status: number } };
      err.response = { status: behavior.status };
      throw err;
    }
    throw new Error("timeout of 3000ms exceeded"); // .response 없음 — 응답 자체를 못 받은 상황
  }
}
