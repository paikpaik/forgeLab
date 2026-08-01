import { Body, Controller, Delete, HttpCode, Param, Post, UseInterceptors } from "@nestjs/common";
import { ResponseInterceptor } from "@paikpaik/node-forge/response/nestjs";
import { WaitingRoomService } from "./waiting-room.service";
import { RemoveWaitingUsersDto } from "./dto/remove-waiting-users.dto";

// 핵심 도메인 API(WaitingRoomController)와 분리한 관리/테스트 전용 엔드포인트 —
// rules/project/convention.md의 Admin/Test API 네이밍 규칙(/admin/* 프리픽스) 적용.
@Controller("admin/rooms/:roomId/waiting-users")
@UseInterceptors(ResponseInterceptor)
export class AdminController {
  constructor(private readonly waitingRoomService: WaitingRoomService) {}

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
}
