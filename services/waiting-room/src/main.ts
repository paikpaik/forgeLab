import "reflect-metadata";
import { NestFactory, HttpAdapterHost } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ForgeExceptionFilter } from "@paikpaik/node-forge/response/nestjs";
import { ForgeLoggerService } from "@paikpaik/node-forge/logger/nestjs";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // dashboard(localhost:4000)가 브라우저에서 이 서비스의 조회 API를 직접 폴링한다 —
  // 로컬 실험 도구라 origin을 넓게 허용한다.
  app.enableCors();

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
