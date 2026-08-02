# syntax=docker/dockerfile:1
FROM node:20-alpine AS build
WORKDIR /app
# 빌드 컨텍스트를 서비스 디렉토리에서 레포 루트로 바꿨다 — @forge-lab/panel-ui(npm workspace
# 의존성)를 심볼릭 링크로 해석하려면 워크스페이스 루트 package.json이 빌드 컨텍스트 안에
# 있어야 한다. 실제로 쓰는 워크스페이스만 최소로 COPY한다.
# .npmrc(레지스트리 인증)는 반드시 워크스페이스 루트(/app/.npmrc)에 있어야 한다 — npm이
# 워크스페이스 멤버 디렉토리 안의 .npmrc는 무시하고 루트 것만 본다.
COPY package.json package-lock.json* .npmrc ./
COPY services/shared-panel-ui/ services/shared-panel-ui/
COPY services/live-auction/package.json services/live-auction/
WORKDIR /app/services/live-auction
RUN --mount=type=secret,id=npm_token \
  echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/npm_token)" >> /app/.npmrc \
  && npm install \
  && rm /app/.npmrc
COPY services/live-auction/tsconfig.json ./
COPY services/live-auction/src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* .npmrc ./
COPY services/shared-panel-ui/ services/shared-panel-ui/
COPY services/live-auction/package.json services/live-auction/
WORKDIR /app/services/live-auction
RUN --mount=type=secret,id=npm_token \
  echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/npm_token)" >> /app/.npmrc \
  && npm install --omit=dev \
  && rm /app/.npmrc
COPY --from=build /app/services/live-auction/dist ./dist
COPY services/live-auction/public ./public
EXPOSE 3500
CMD ["node", "dist/main.js"]
