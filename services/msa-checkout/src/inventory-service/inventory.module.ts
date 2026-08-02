import { Module, OnModuleInit } from "@nestjs/common";
import { RedisModule } from "@paikpaik/node-forge/redis/nestjs";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import { DEMO_PRODUCT_PLENTY, DEMO_PRODUCT_SCARCE } from "../shared/constants";
import { TraceRecorderService } from "../shared/trace-recorder";

const redisOptions = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

@Module({
  imports: [RedisModule.forRoot(redisOptions)],
  controllers: [InventoryController],
  providers: [InventoryService, TraceRecorderService],
})
export class InventoryModule implements OnModuleInit {
  constructor(private readonly inventoryService: InventoryService) {}

  async onModuleInit(): Promise<void> {
    await this.inventoryService.seedIfMissing(DEMO_PRODUCT_PLENTY, 1000);
    await this.inventoryService.seedIfMissing(DEMO_PRODUCT_SCARCE, 1);
  }
}
