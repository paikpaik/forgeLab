import { Body, Controller, Get, Param, Post, UseInterceptors } from "@nestjs/common";
import { ResponseInterceptor } from "@paikpaik/node-forge/response/nestjs";
import { AuctionService } from "./auction.service";
import { PlaceBidDto } from "./dto/place-bid.dto";

@Controller("auctions")
@UseInterceptors(ResponseInterceptor)
export class AuctionController {
  constructor(private readonly auctionService: AuctionService) {}

  @Get()
  list() {
    return this.auctionService.listLive();
  }

  @Get(":id")
  getState(@Param("id") id: string) {
    return this.auctionService.getState(id);
  }

  @Post(":id/bids")
  placeBid(@Param("id") id: string, @Body() dto: PlaceBidDto) {
    return this.auctionService.placeBid(id, dto.bidderId, dto.amount);
  }

  @Get(":id/bids")
  listBids(@Param("id") id: string) {
    return this.auctionService.listBids(id);
  }
}
