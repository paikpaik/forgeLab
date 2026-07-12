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
COPY scripts ./scripts
EXPOSE 3000
CMD ["node", "dist/main.js"]
