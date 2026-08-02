import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { FakePgModule } from "./fake-pg.module";

// 실제 외부 PG를 흉내내는 테스트 더블 — 우리 자체 컨벤션(ForgeExceptionFilter/ApiResponse
// 봉투)을 일부러 안 쓴다. 진짜 외부 서비스라면 우리 응답 포맷을 알 리 없기 때문이다.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(FakePgModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = Number(process.env.PORT ?? 3601);
  await app.listen(port);
}

void bootstrap();
