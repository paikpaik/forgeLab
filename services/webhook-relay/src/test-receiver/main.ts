import "reflect-metadata";
import type { IncomingMessage } from "node:http";
import { json } from "express";
import { NestFactory, HttpAdapterHost } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ForgeExceptionFilter } from "@paikpaik/node-forge/response/nestjs";
import { ForgeLoggerService } from "@paikpaik/node-forge/logger/nestjs";
import { TestReceiverAppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  // HMAC 서명은 발신 측이 실제로 보낸 바이트 그대로에 대해 계산된다 — Express의 기본
  // JSON 파서가 파싱한 뒤 다시 직렬화하면 키 순서/공백이 달라져 서명이 안 맞을 수 있다
  // (Stripe 웹훅 문서가 명시적으로 경고하는 함정). bodyParser를 끄고 raw body를 직접
  // 캡처하는 파서를 붙인다.
  const app = await NestFactory.create(TestReceiverAppModule, { bufferLogs: true, bodyParser: false });
  app.use(
    json({
      verify: (req: IncomingMessage & { rawBody?: string }, _res, buf: Buffer) => {
        req.rawBody = buf.toString("utf-8");
      },
    }),
  );

  app.useLogger(app.get(ForgeLoggerService));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ForgeExceptionFilter(app.get(HttpAdapterHost)));

  const port = Number(process.env.PORT ?? 3401);
  await app.listen(port);
}

void bootstrap();
