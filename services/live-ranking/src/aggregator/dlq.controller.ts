import { Controller, Delete, Get, UseInterceptors } from "@nestjs/common";
import { ResponseInterceptor } from "@paikpaik/node-forge/response/nestjs";
import { DlqLogService } from "./dlq-log.service";
import type { DlqOverview } from "./dlq-log.service";

@Controller("admin/dlq")
@UseInterceptors(ResponseInterceptor)
export class DlqController {
  constructor(private readonly dlqLogService: DlqLogService) {}

  @Get()
  getOverview(): Promise<DlqOverview> {
    return this.dlqLogService.getOverview();
  }

  @Delete()
  clear(): Promise<void> {
    return this.dlqLogService.clear();
  }
}
