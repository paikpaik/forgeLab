import { Injectable } from "@nestjs/common";
import { Subject } from "rxjs";

export interface AdminLogEvent {
  type: "created" | "published" | "confirmed";
  message: string;
  at: string;
}

// 프로세스 로컬 브로드캐스터 — api/fulfillment는 서로 다른 컨테이너라 메모리를 공유하지
// 않으므로, 각 프로세스가 자기 안에서 일어난 이벤트만 안다. /admin/logs/stream(SSE)이
// 이 stream$을 그대로 구독해서 패널에 실시간으로 흘려보낸다(docker logs 안 봐도
// 생성/발행/확인 3단계를 실시간으로 확인하기 위한 목적 — dashboard-panel-expansion 3단계).
@Injectable()
export class AdminEventsService {
  private readonly subject = new Subject<AdminLogEvent>();
  readonly stream$ = this.subject.asObservable();

  emit(type: AdminLogEvent["type"], message: string): void {
    this.subject.next({ type, message, at: new Date().toISOString() });
  }
}
