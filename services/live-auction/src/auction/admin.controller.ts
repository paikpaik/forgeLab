import { Body, Controller, Param, Post, UseInterceptors } from "@nestjs/common";
import { ResponseInterceptor } from "@paikpaik/node-forge/response/nestjs";
import { AuctionService } from "./auction.service";
import { CreateAuctionDto } from "./dto/create-auction.dto";

// 경매 생성/강제 종료는 실사용자(입찰자)가 아니라 운영자가 하는 테스트/관리 작업이라
// 컨벤션대로 /admin/* 프리픽스 아래 둔다.
@Controller("admin/auctions")
@UseInterceptors(ResponseInterceptor)
export class AdminAuctionController {
  constructor(private readonly auctionService: AuctionService) {}

  @Post()
  create(@Body() dto: CreateAuctionDto) {
    return this.auctionService.createAuction(dto);
  }

  @Post(":id/end")
  async forceEnd(@Param("id") id: string): Promise<{ ended: boolean }> {
    const ended = await this.auctionService.closeAuction(id);
    return { ended };
  }
}
