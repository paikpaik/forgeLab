export interface ChannelMessage {
  eventType: string;
  payload: unknown;
  verified: boolean;
  at: string;
}
