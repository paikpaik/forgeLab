import { Module } from "@nestjs/common";
import { AdminEventsModule } from "@paikpaik/node-forge/events/nestjs";
import { WaitingRoomController } from "./waiting-room.controller";
import { AdminController } from "./admin.controller";
import { WaitingRoomService } from "./waiting-room.service";
import { AdmissionService } from "./admission.service";
import { TokenService } from "./token.service";
import { WaitingRoomMetrics } from "./waiting-room.metrics";

@Module({
  imports: [AdminEventsModule.forRoot({ path: "admin/logs" })],
  controllers: [WaitingRoomController, AdminController],
  providers: [WaitingRoomService, AdmissionService, TokenService, WaitingRoomMetrics],
})
export class WaitingRoomModule {}
