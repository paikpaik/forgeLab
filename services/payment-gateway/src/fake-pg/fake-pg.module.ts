import { Module } from "@nestjs/common";
import { ForgeHttpClient } from "@paikpaik/node-forge/http";
import { FakePgController } from "./fake-pg.controller";
import { FakePgAdminController } from "./fake-pg-admin.controller";
import { FakePgService } from "./fake-pg.service";
import { CALLBACK_HTTP_CLIENT } from "./fake-pg.constants";

@Module({
  controllers: [FakePgController, FakePgAdminController],
  providers: [
    FakePgService,
    {
      provide: CALLBACK_HTTP_CLIENT,
      useFactory: () =>
        new ForgeHttpClient({
          baseURL: process.env.PAYMENT_GATEWAY_URL ?? "http://localhost:3600",
          timeout: 5000,
        }),
    },
  ],
})
export class FakePgModule {}
