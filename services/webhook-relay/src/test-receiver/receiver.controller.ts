import { Body, Controller, Headers, Inject, Logger, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { AdminEventBus } from "@paikpaik/node-forge/events";
import { ADMIN_EVENT_BUS } from "@paikpaik/node-forge/events/nestjs";
import { verifySignature } from "../shared/hmac";
import type { TestReceiverScenario } from "../shared/constants";
import type { ChannelMessage } from "../shared/channel-message";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface WebhookBody {
  eventId: string;
  type: string;
  payload: unknown;
  createdAt: string;
}

// 실제 웹훅 구독자를 흉내내는 테스트/데모 전용 서버 — 시나리오별로 다르게 반응해서
// circuit breaker/재시도/타임아웃을 실제로 재현할 수 있게 한다. 등록 시 엔드포인트 URL에
// ?secret=<hex>를 붙여서 서명 검증에 필요한 비밀키를 함께 전달한다(이 서버는 ingest와
// DB를 공유하지 않는 완전히 별도 프로세스라 다른 방법으로 secret을 알 길이 없음).
@Controller("receive")
export class ReceiverController {
  private readonly logger = new Logger(ReceiverController.name);

  constructor(@Inject(ADMIN_EVENT_BUS) private readonly channel: AdminEventBus<ChannelMessage>) {}

  @Post(":scenario")
  async receive(
    @Param("scenario") scenario: TestReceiverScenario,
    @Query("secret") secret: string | undefined,
    @Headers("x-webhook-signature") signature: string | undefined,
    @Body() body: WebhookBody,
    @Req() req: Request & { rawBody?: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ received: boolean; verified: boolean }> {
    const verified = secret ? verifySignature(req.rawBody ?? "", signature, secret).valid : false;
    this.logger.log(`[${scenario}] 웹훅 수신 — 서명 검증: ${verified ? "통과" : "실패"}`);

    if (scenario === "fail") {
      res.status(500);
    } else if (scenario === "slow") {
      await delay(3000);
    } else if (scenario === "timeout") {
      await delay(8000);
    }

    // "fail"은 이 엔드포인트가 애초에 처리를 못 하는 상황을 흉내내는 시나리오라 채널에 아무
    // 메시지도 남기지 않는다 — 실제로 아무것도 처리되지 않았기 때문. 그 외에는 실제로 받아서
    // 처리했다는 걸 public/channel.html이 실시간으로 보여준다(웹훅의 실사용 효과를 눈에 보이게).
    if (scenario !== "fail") {
      this.channel.emit({ eventType: body.type, payload: body.payload, verified, at: new Date().toISOString() });
    }

    return { received: true, verified };
  }
}
