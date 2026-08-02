import { Controller, Get, Param, UseGuards, UseInterceptors } from "@nestjs/common";
import { ResponseInterceptor } from "@paikpaik/node-forge/response/nestjs";
import { JwtAuthGuard, RolesGuard, Roles } from "@paikpaik/node-forge/auth/nestjs";
import { OrchestratorGrpcClient } from "./clients/orchestrator-grpc-client";
import { TraceRecorderService } from "../shared/trace-recorder";
import type { TraceSpan } from "../shared/trace-recorder";

// saga가 도달한 traceId는 orchestrator의 saga_instances 테이블에 영속화돼 있다(saga 생성
// 시점에 저장) — gateway는 자체 DB가 없으므로 이미 갖고 있는 GetSagaStatus gRPC 호출로
// traceId를 얻은 뒤, 그 traceId로 Redis에 쌓인 스팬을 조회한다.
@Controller("admin/traces")
@UseInterceptors(ResponseInterceptor)
@UseGuards(JwtAuthGuard, RolesGuard)
export class TracesController {
  constructor(
    private readonly orchestrator: OrchestratorGrpcClient,
    private readonly traceRecorder: TraceRecorderService,
  ) {}

  @Get(":sagaId")
  @Roles("customer", "admin")
  async getTrace(@Param("sagaId") sagaId: string): Promise<{ found: boolean; traceId?: string; spans?: TraceSpan[] }> {
    const status = await this.orchestrator.getSagaStatus(sagaId);
    if (!status.found || !status.traceId) return { found: false };

    const spans = await this.traceRecorder.getSpans(status.traceId);
    return { found: true, traceId: status.traceId, spans };
  }
}
