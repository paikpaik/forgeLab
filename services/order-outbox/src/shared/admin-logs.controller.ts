import { Controller, Sse } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import type { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { AdminEventsService } from "./admin-events.service";

// api/fulfillment가 각자 자기 프로세스 포트에서 이 컨트롤러를 그대로 재사용한다
// (rules/project/convention.md의 Admin/Test API 네이밍 — /admin/* 프리픽스).
@Controller("admin/logs")
export class AdminLogsController {
  constructor(private readonly adminEvents: AdminEventsService) {}

  @Sse("stream")
  stream(): Observable<MessageEvent> {
    return this.adminEvents.stream$.pipe(map((event) => ({ data: event })));
  }
}
