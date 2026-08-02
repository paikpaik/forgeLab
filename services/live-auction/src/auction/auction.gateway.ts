import { OnModuleInit } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { InjectRedis } from "@paikpaik/node-forge/redis/nestjs";
import type { ForgeRedisClient } from "@paikpaik/node-forge/redis";
import { AUCTION_EVENTS_CHANNEL } from "../shared/constants";
import type { AuctionEventPayload } from "../shared/constants";

// 이 실험의 핵심 검증 지점 — 입찰을 실제로 처리한 인스턴스가 아니라 "다른" 인스턴스에
// WebSocket으로 붙어 있는 클라이언트도 똑같이 실시간으로 받아야 한다. 각 인스턴스가 Redis
// pub/sub 채널을 독립적으로 구독하고 있다가, 메시지가 오면 자기한테 붙은 소켓 중 해당
// 경매 룸에 있는 것들에게만 브로드캐스트한다.
@WebSocketGateway({ cors: { origin: "*" } })
export class AuctionGateway implements OnModuleInit {
  @WebSocketServer() private readonly server!: Server;

  constructor(@InjectRedis() private readonly redis: ForgeRedisClient) {}

  onModuleInit(): void {
    this.redis.subscribe(AUCTION_EVENTS_CHANNEL, (message) => {
      const event = message as AuctionEventPayload;
      this.server.to(`auction:${event.auctionId}`).emit(event.type, event.data);
    });
  }

  @SubscribeMessage("join")
  handleJoin(@ConnectedSocket() client: Socket, @MessageBody() data: { auctionId: string }): void {
    void client.join(`auction:${data.auctionId}`);
  }

  @SubscribeMessage("leave")
  handleLeave(@ConnectedSocket() client: Socket, @MessageBody() data: { auctionId: string }): void {
    void client.leave(`auction:${data.auctionId}`);
  }
}
