export const AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET ?? "msa-checkout-lab-secret";
// @nestjs/jwt(JwtModule.register)의 signOptions.expiresIn에 그대로 넘기는 형식(ms 라이브러리 문자열).
export const AUTH_TOKEN_TTL = process.env.AUTH_TOKEN_TTL ?? "15m";

export const HEALTH_CHECK_CACHE_MS = 5000;

// saga 폴러 주기 — order-outbox의 OutboxPublisherService(@Interval)와 동일한 패턴.
export const SAGA_POLL_INTERVAL_MS = Number(process.env.SAGA_POLL_INTERVAL_MS ?? 2000);
export const SAGA_POLL_BATCH_SIZE = Number(process.env.SAGA_POLL_BATCH_SIZE ?? 20);

// 재고 부족 재현/다중 인스턴스 테스트용 데모 상품. 실제 상품 카탈로그는 이 실험 스코프 밖이라
// inventory-service 부팅 시 이 상품들을 고정 수량으로 시드한다.
export const DEMO_PRODUCT_PLENTY = "widget-plenty";
export const DEMO_PRODUCT_SCARCE = "widget-scarce";
