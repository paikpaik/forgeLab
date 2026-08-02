import { Module } from "@nestjs/common";
import { RedisModule } from "@paikpaik/node-forge/redis/nestjs";
import { OrderController } from "./order.controller";
import { OrderService } from "./order.service";
import { TraceRecorderService } from "../shared/trace-recorder";

const redisOptions = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

@Module({
  imports: [RedisModule.forRoot(redisOptions)],
  controllers: [OrderController],
  providers: [OrderService, TraceRecorderService],
})
export class OrderModule {}
