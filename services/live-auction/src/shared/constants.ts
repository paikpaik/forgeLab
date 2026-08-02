export const AUCTION_CLOSE_INTERVAL_MS = Number(process.env.AUCTION_CLOSE_INTERVAL_MS ?? 2000);

// 입찰 하나를 처리하는 동안(조회→검증→갱신) 락을 쥐고 있는 최대 시간 — 이 시간을 넘기면
// 락이 자동 해제돼서 프로세스가 죽어도 경매 하나가 영원히 멈추지 않는다.
export const BID_LOCK_TTL_SECONDS = 5;
export const BID_LOCK_RETRIES = 5;
export const BID_LOCK_RETRY_DELAY_MS = 100;

export function auctionLockKey(auctionId: string): string {
  return `auction:${auctionId}:lock`;
}

export function auctionCurrentKey(auctionId: string): string {
  return `auction:${auctionId}:current`;
}

// 모든 인스턴스가 이 채널 하나를 구독한다 — auctionId는 페이로드에 실어서 구분한다
// (경매마다 채널을 따로 만들면 경매 생성/종료 때마다 구독 관리가 필요해져 번거로움).
export const AUCTION_EVENTS_CHANNEL = "auction:events";

export interface AuctionEventPayload {
  type: "bid-placed" | "auction-ended";
  auctionId: string;
  data: unknown;
}
