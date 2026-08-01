# syntax=docker/dockerfile:1
FROM node:20-alpine AS build
WORKDIR /app
# 빌드 컨텍스트를 서비스 디렉토리에서 레포 루트로 바꿨다 — @forge-lab/panel-ui(npm workspace
# 의존성)를 심볼릭 링크로 해석하려면 워크스페이스 루트 package.json이 컨텍스트 안에 있어야
# 한다. 실제로 쓰는 워크스페이스만 최소로 COPY한다(다른 실험은 이 이미지에 안 들어감).
# .npmrc(레지스트리 인증)는 반드시 워크스페이스 루트(/app/.npmrc)에 있어야 한다 — npm이
# 워크스페이스 멤버 디렉토리 안의 .npmrc는 "npm warn config ignoring workspace config"로
# 무시하고 루트 것만 본다.
COPY package.json package-lock.json* .npmrc ./
COPY services/shared-panel-ui/ services/shared-panel-ui/
COPY services/order-outbox/package.json services/order-outbox/
WORKDIR /app/services/order-outbox
RUN --mount=type=secret,id=npm_token \
  echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/npm_token)" >> /app/.npmrc \
  && npm install \
  && rm /app/.npmrc
COPY services/order-outbox/tsconfig.json ./
COPY services/order-outbox/src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* .npmrc ./
COPY services/shared-panel-ui/ services/shared-panel-ui/
COPY services/order-outbox/package.json services/order-outbox/
WORKDIR /app/services/order-outbox
RUN --mount=type=secret,id=npm_token \
  echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/npm_token)" >> /app/.npmrc \
  && npm install --omit=dev \
  && rm /app/.npmrc
COPY --from=build /app/services/order-outbox/dist ./dist
COPY services/order-outbox/public ./public
# api/fulfillment는 이미지는 같고 docker-compose의 command:로 어느 main.js를 띄울지만 다르다
# (live-ranking의 ingest/aggregator와 동일한 패턴).
CMD ["node", "dist/api/main.js"]
