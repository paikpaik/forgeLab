import { ArgumentsHost, Catch } from "@nestjs/common";
import { BaseExceptionFilter, HttpAdapterHost } from "@nestjs/core";
import { status as GrpcStatus } from "@grpc/grpc-js";
import { fail } from "@paikpaik/node-forge/response";
import { ErrorCode } from "@paikpaik/node-forge/core";

// NestJS의 gRPC 클라이언트 프록시(@nestjs/microservices)는 실패한 호출을 grpc-js의
// ServiceError 그대로 던진다(자체 변환 없음) — ForgeExceptionFilter는 ForgeBizError/
// ForgeHttpError만 잡으므로, 지금까지는 orchestrator/order-service/inventory-service가
// 죽거나 응답이 없으면 전부 500으로 뭉뚱그려졌다(실제로 RolesGuard 버그 재현 때도 이렇게
// 500으로만 보였음). gRPC status code를 grpc-gateway가 쓰는 표준 매핑대로 HTTP status로
// 변환해서 클라이언트가 "일시적으로 서비스가 안 되는 건지(503)", "그런 리소스가 없는
// 건지(404)"를 구분할 수 있게 한다.
const GRPC_TO_HTTP: Record<number, { httpStatus: number; errorCode: string }> = {
  [GrpcStatus.CANCELLED]: { httpStatus: 499, errorCode: ErrorCode.INTERNAL_ERROR },
  [GrpcStatus.UNKNOWN]: { httpStatus: 500, errorCode: ErrorCode.INTERNAL_ERROR },
  [GrpcStatus.INVALID_ARGUMENT]: { httpStatus: 400, errorCode: ErrorCode.BAD_REQUEST },
  [GrpcStatus.DEADLINE_EXCEEDED]: { httpStatus: 504, errorCode: ErrorCode.INTERNAL_ERROR },
  [GrpcStatus.NOT_FOUND]: { httpStatus: 404, errorCode: ErrorCode.NOT_FOUND },
  [GrpcStatus.ALREADY_EXISTS]: { httpStatus: 409, errorCode: ErrorCode.CONFLICT },
  [GrpcStatus.PERMISSION_DENIED]: { httpStatus: 403, errorCode: ErrorCode.FORBIDDEN },
  [GrpcStatus.RESOURCE_EXHAUSTED]: { httpStatus: 429, errorCode: ErrorCode.TOO_MANY_REQUESTS },
  [GrpcStatus.FAILED_PRECONDITION]: { httpStatus: 400, errorCode: ErrorCode.BAD_REQUEST },
  [GrpcStatus.ABORTED]: { httpStatus: 409, errorCode: ErrorCode.CONFLICT },
  [GrpcStatus.OUT_OF_RANGE]: { httpStatus: 400, errorCode: ErrorCode.BAD_REQUEST },
  [GrpcStatus.UNIMPLEMENTED]: { httpStatus: 501, errorCode: ErrorCode.INTERNAL_ERROR },
  [GrpcStatus.INTERNAL]: { httpStatus: 500, errorCode: ErrorCode.INTERNAL_ERROR },
  [GrpcStatus.UNAVAILABLE]: { httpStatus: 503, errorCode: ErrorCode.INTERNAL_ERROR },
  [GrpcStatus.DATA_LOSS]: { httpStatus: 500, errorCode: ErrorCode.INTERNAL_ERROR },
  [GrpcStatus.UNAUTHENTICATED]: { httpStatus: 401, errorCode: ErrorCode.UNAUTHORIZED },
};

interface GrpcServiceError extends Error {
  code: number;
  details: string;
}

function isGrpcServiceError(exception: unknown): exception is GrpcServiceError {
  if (!(exception instanceof Error)) return false;
  const code = (exception as Error & { code?: unknown }).code;
  return typeof code === "number" && code in GRPC_TO_HTTP;
}

// 이 필터는 catch-all(`@Catch()`)이라 반드시 ForgeExceptionFilter *다음*에 등록해야 한다 —
// NestJS는 등록된 필터를 순서대로 검사해 처음 매칭되는 것을 쓰는데, catch-all이 먼저
// 등록되면 ForgeBizError까지 전부 가로채버린다. gRPC 에러가 아닌 경우(진짜 버그 등)는
// `super.catch()`로 위임해 기존과 동일한 기본 500 처리로 흘려보낸다(회귀 없음).
@Catch()
export class GrpcStatusExceptionFilter extends BaseExceptionFilter {
  constructor(httpAdapterHost: HttpAdapterHost) {
    super(httpAdapterHost.httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (!isGrpcServiceError(exception)) {
      super.catch(exception, host);
      return;
    }

    const mapping = GRPC_TO_HTTP[exception.code] ?? { httpStatus: 500, errorCode: ErrorCode.INTERNAL_ERROR };
    const response = host.switchToHttp().getResponse();
    this.applicationRef?.reply(
      response,
      fail(mapping.errorCode, exception.details || exception.message),
      mapping.httpStatus,
    );
  }
}
