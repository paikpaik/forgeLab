import "reflect-metadata";
import { NestFactory, HttpAdapterHost } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ForgeExceptionFilter } from "@paikpaik/node-forge/response/nestjs";
import { ForgeLoggerService } from "@paikpaik/node-forge/logger/nestjs";
import { DeliveryWorkerAppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(DeliveryWorkerAppModule, { bufferLogs: true });

  app.useLogger(app.get(ForgeLoggerService));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ForgeExceptionFilter(app.get(HttpAdapterHost)));

  // 호스트 포트를 노출하지 않는다(docker-compose.yml 참고) — 다중 인스턴스로 스케일되는
  // 프로세스라 고정 포트 매핑이 애초에 불가능하고, /health·/metrics는 필요하면 docker exec
  // 또는 내부 네트워크로 접근한다(msa-checkout의 inventory-service와 동일한 이유).
  const port = Number(process.env.PORT ?? 3450);
  await app.listen(port);
}

void bootstrap();
