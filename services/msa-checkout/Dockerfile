# syntax=docker/dockerfile:1
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* .npmrc ./
RUN --mount=type=secret,id=npm_token \
  echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/npm_token)" >> .npmrc \
  && npm install \
  && rm .npmrc
COPY tsconfig.json ./
COPY proto ./proto
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* .npmrc ./
RUN --mount=type=secret,id=npm_token \
  echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/npm_token)" >> .npmrc \
  && npm install --omit=dev \
  && rm .npmrc
COPY --from=build /app/dist ./dist
COPY public ./public
COPY proto ./proto
# 이미지는 하나, 어느 프로세스(gateway/orchestrator/order-service/inventory-service)를
# 띄울지는 docker-compose의 command:로만 구분한다 (order-outbox/live-ranking과 동일 패턴).
CMD ["node", "dist/gateway/main.js"]
