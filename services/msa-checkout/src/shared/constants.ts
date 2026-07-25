// 인증/인가는 node-forge/auth(JwtAuthModule, JwtAuthGuard, RolesGuard)를 그대로 쓴다 — Role은
// 이 서비스의 도메인 타입이라 forge가 아니라 여기서 정의한다(forge의 RolesGuard는 role을
// string으로만 다뤄서 특정 타입을 강제하지 않는다).
export type Role = "customer" | "admin";

export const AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET ?? "msa-checkout-lab-secret";
// node-forge/auth의 signToken()/JwtAuthModule.forRoot()에 그대로 넘기는 형식(jsonwebtoken의
// expiresIn 문자열, 예: "15m").
export const AUTH_TOKEN_TTL = process.env.AUTH_TOKEN_TTL ?? "15m";

export const HEALTH_CHECK_CACHE_MS = 5000;

// saga 폴러 주기 — order-outbox의 OutboxPublisherService(@Interval)와 동일한 패턴.
export const SAGA_POLL_INTERVAL_MS = Number(process.env.SAGA_POLL_INTERVAL_MS ?? 2000);
export const SAGA_POLL_BATCH_SIZE = Number(process.env.SAGA_POLL_BATCH_SIZE ?? 20);

// 재고 부족 재현/다중 인스턴스 테스트용 데모 상품. 실제 상품 카탈로그는 이 실험 스코프 밖이라
// inventory-service 부팅 시 이 상품들을 고정 수량으로 시드한다.
export const DEMO_PRODUCT_PLENTY = "widget-plenty";
export const DEMO_PRODUCT_SCARCE = "widget-scarce";
