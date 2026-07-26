import { Module, OnModuleInit } from "@nestjs/common";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import { DEMO_PRODUCT_PLENTY, DEMO_PRODUCT_SCARCE } from "../shared/constants";

@Module({
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule implements OnModuleInit {
  constructor(private readonly inventoryService: InventoryService) {}

  async onModuleInit(): Promise<void> {
    await this.inventoryService.seedIfMissing(DEMO_PRODUCT_PLENTY, 1000);
    await this.inventoryService.seedIfMissing(DEMO_PRODUCT_SCARCE, 1);
  }
}
