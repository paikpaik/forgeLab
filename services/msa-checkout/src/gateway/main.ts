import "reflect-metadata";
import { join } from "node:path";
import { NestFactory, HttpAdapterHost } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ValidationPipe } from "@nestjs/common";
import { ForgeExceptionFilter } from "@paikpaik/node-forge/response/nestjs";
import { ForgeLoggerService } from "@paikpaik/node-forge/logger/nestjs";
import { GrpcStatusExceptionFilter } from "./filters/grpc-status.filter";
import { GatewayAppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(GatewayAppModule, { bufferLogs: true });

  // 이 실험의 유일한 REST 진입점 — panel.html도 gateway가 서빙한다.
  app.useStaticAssets(join(__dirname, "..", "..", "public"));
  // 4개 실험 패널 공유 CSS/JS — require.resolve로 실제 위치를 찾는다(waiting-room과 동일 패턴).
  const panelUiDist = join(require.resolve("@forge-lab/panel-ui/package.json"), "..", "dist");
  app.useStaticAssets(panelUiDist, { prefix: "/shared/" });

  // panel.html이 같은 오리진에서 서빙되므로 기능상 CORS가 꼭 필요하진 않지만, "정책"
  // 계층이 실제로 존재해야 하므로 명시적으로 설정한다 — CORS_ORIGINS 미지정 시 랩 환경
  // 편의상 전체 허용(요청 Origin 그대로 반사), 필요하면 콤마 구분 목록으로 좁힐 수 있음.
  const corsOrigins = process.env.CORS_ORIGINS?.split(",").map((origin) => origin.trim());
  app.enableCors({ origin: corsOrigins ?? true, credentials: true });

  app.useLogger(app.get(ForgeLoggerService));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // 순서 중요: GrpcStatusExceptionFilter는 catch-all(@Catch())이라 ForgeExceptionFilter
  // *다음*에 등록해야 한다. 먼저 등록하면 ForgeBizError까지 전부 가로채버린다.
  app.useGlobalFilters(
    new ForgeExceptionFilter(app.get(HttpAdapterHost)),
    new GrpcStatusExceptionFilter(app.get(HttpAdapterHost)),
  );

  const port = Number(process.env.PORT ?? 3300);
  await app.listen(port);
}

void bootstrap();
