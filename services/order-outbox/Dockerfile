# syntax=docker/dockerfile:1
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* .npmrc ./
RUN --mount=type=secret,id=npm_token \
  echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/npm_token)" >> .npmrc \
  && npm install \
  && rm .npmrc
COPY tsconfig.json ./
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
# api/fulfillment는 이미지는 같고 docker-compose의 command:로 어느 main.js를 띄울지만 다르다
# (live-ranking의 ingest/aggregator와 동일한 패턴).
CMD ["node", "dist/api/main.js"]
