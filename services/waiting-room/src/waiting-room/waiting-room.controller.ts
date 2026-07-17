import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseInterceptors } from "@nestjs/common";
import { ResponseInterceptor } from "@paikpaik/node-forge/response/nestjs";
import { WaitingRoomService } from "./waiting-room.service";
import { RegisterWaitingUserDto } from "./dto/register-waiting-user.dto";
import { RemoveWaitingUsersDto } from "./dto/remove-waiting-users.dto";
import { VerifyTokenDto } from "./dto/verify-token.dto";
import type {
  QueueOverviewDto,
  RegisterResultDto,
  VerifyTokenResultDto,
  WaitingStatusDto,
} from "./dto/waiting-status.dto";

@Controller("rooms/:roomId/waiting-users")
@UseInterceptors(ResponseInterceptor)
export class WaitingRoomController {
  constructor(private readonly waitingRoomService: WaitingRoomService) {}

  @Post()
  register(
    @Param("roomId") roomId: string,
    @Body() dto: RegisterWaitingUserDto,
  ): Promise<RegisterResultDto> {
    return this.waitingRoomService.register(roomId, dto.userId);
  }

  @Get()
  getOverview(@Param("roomId") roomId: string): Promise<QueueOverviewDto> {
    return this.waitingRoomService.getOverview(roomId);
  }

  @Get(":userId")
  getStatus(
    @Param("roomId") roomId: string,
    @Param("userId") userId: string,
  ): Promise<WaitingStatusDto> {
    return this.waitingRoomService.getStatus(roomId, userId);
  }

  @Delete()
  reset(@Param("roomId") roomId: string): Promise<void> {
    return this.waitingRoomService.reset(roomId);
  }

  @Post("remove")
  @HttpCode(200)
  removeUsers(
    @Param("roomId") roomId: string,
    @Body() dto: RemoveWaitingUsersDto,
  ): Promise<{ removed: number }> {
    return this.waitingRoomService.removeUsers(roomId, dto.userIds);
  }

  @Post("verify")
  @HttpCode(200)
  verifyToken(
    @Param("roomId") roomId: string,
    @Body() dto: VerifyTokenDto,
  ): Promise<VerifyTokenResultDto> {
    return this.waitingRoomService.verifyToken(roomId, dto.token);
  }
}
