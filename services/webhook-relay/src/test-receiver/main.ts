import "reflect-metadata";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";
import { json } from "express";
import { NestFactory, HttpAdapterHost } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ValidationPipe } from "@nestjs/common";
import { ForgeExceptionFilter } from "@paikpaik/node-forge/response/nestjs";
import { ForgeLoggerService } from "@paikpaik/node-forge/logger/nestjs";
import { TestReceiverAppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  // HMAC 서명은 발신 측이 실제로 보낸 바이트 그대로에 대해 계산된다 — Express의 기본
  // JSON 파서가 파싱한 뒤 다시 직렬화하면 키 순서/공백이 달라져 서명이 안 맞을 수 있다
  // (Stripe 웹훅 문서가 명시적으로 경고하는 함정). bodyParser를 끄고 raw body를 직접
  // 캡처하는 파서를 붙인다.
  const app = await NestFactory.create<NestExpressApplication>(TestReceiverAppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  app.use(
    json({
      verify: (req: IncomingMessage & { rawBody?: string }, _res, buf: Buffer) => {
        req.rawBody = buf.toString("utf-8");
      },
    }),
  );

  // public/channel.html — 웹훅이 실제로 도착하는 걸 눈으로 보여주는 데모 화면(ingest의
  // panel.html과 같은 public/ 디렉토리를 공유, 세 프로세스가 같은 이미지라 접근 가능).
  // main.ts가 dist/test-receiver/main.js로 컴파일되므로 ingest와 동일하게 두 단계 위.
  app.useStaticAssets(join(__dirname, "..", "..", "public"));
  const panelUiDist = join(require.resolve("@forge-lab/panel-ui/package.json"), "..", "dist");
  app.useStaticAssets(panelUiDist, { prefix: "/shared/" });

  app.useLogger(app.get(ForgeLoggerService));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ForgeExceptionFilter(app.get(HttpAdapterHost)));

  const port = Number(process.env.PORT ?? 3401);
  await app.listen(port);
}

void bootstrap();
