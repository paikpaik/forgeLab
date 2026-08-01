import "reflect-metadata";
import { join } from "node:path";
import { NestFactory, HttpAdapterHost } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ValidationPipe } from "@nestjs/common";
import { ForgeExceptionFilter } from "@paikpaik/node-forge/response/nestjs";
import { ForgeLoggerService } from "@paikpaik/node-forge/logger/nestjs";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  // public/panel.html — dashboard가 forge-lab.json의 panelUrl로 iframe에 그대로 띄운다.
  // 같은 오리진에서 서빙하므로 panel.html의 fetch는 CORS 없이 이 서비스 API를 바로 호출한다.
  app.useStaticAssets(join(__dirname, "..", "public"));
  // 4개 실험 패널이 공유하는 CSS/JS — npm workspaces가 패키지를 루트 node_modules로
  // 호이스팅할 수도, 서비스 로컬 node_modules에 둘 수도 있어서 상대경로로 고정하지 않고
  // require.resolve로 실제 위치를 찾는다(proto 파일 "빌드 산출물 경로 불일치" 버그
  // 재발 방지). /shared/*로 마운트.
  const panelUiDist = join(require.resolve("@forge-lab/panel-ui/package.json"), "..", "dist");
  app.useStaticAssets(panelUiDist, { prefix: "/shared/" });

  app.useLogger(app.get(ForgeLoggerService));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // ResponseInterceptor는 전역이 아니라 WaitingRoomController에만 건다 — 전역으로 걸면
  // node-forge의 MetricsController(Prometheus 텍스트 포맷)까지 ok()로 JSON 감싸버려서
  // 스크래핑이 깨진다.
  app.useGlobalFilters(new ForgeExceptionFilter(app.get(HttpAdapterHost)));

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
