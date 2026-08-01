import { Module } from "@nestjs/common";
import { WaitingRoomController } from "./waiting-room.controller";
import { AdminController } from "./admin.controller";
import { WaitingRoomService } from "./waiting-room.service";
import { AdmissionService } from "./admission.service";
import { TokenService } from "./token.service";
import { WaitingRoomMetrics } from "./waiting-room.metrics";

@Module({
  controllers: [WaitingRoomController, AdminController],
  providers: [WaitingRoomService, AdmissionService, TokenService, WaitingRoomMetrics],
})
export class WaitingRoomModule {}
