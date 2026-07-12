# dashboard

`services/` 아래 모든 실험을 한 화면에서 실행/중지/데이터 주입할 수 있는 관리 UI. 비즈니스
로직은 없고, 각 서비스의 `docker-compose.yml`을 `docker compose` CLI로 오케스트레이션하는
역할만 한다.

## 실행

```bash
npm install

# 자식 프로세스로 실행하는 docker compose가 이미지를 빌드할 때 필요하다
# (개별 서비스가 GitHub Packages private 패키지를 설치하는 경우)
export NODE_AUTH_TOKEN=ghp_xxx
export HOST_PORT=3100   # 선택 — 서비스 docker-compose.yml이 호스트 포트를 환경변수로 받는 경우

npm run dev
# http://localhost:4000
```

호스트에 `docker`(compose v2 포함)가 설치되어 있어야 한다. dashboard는 자신이 받은 환경변수를
그대로 물려서 `docker compose` 하위 프로세스를 실행하므로, 서비스별로 필요한 환경변수는
dashboard 실행 전에 export해둬야 한다.

## 동작 방식

- `services/*/docker-compose.yml`이 있는 디렉토리를 서비스로 자동 인식한다 (`src/registry.ts`)
- Up/Down/Status는 `docker compose -f <서비스>/docker-compose.yml <명령>`을 그대로 실행한다
- Seed는 `docker compose exec app npm run seed` 컨벤션을 호출한다 — 서비스가 아직 `seed`
  스크립트를 제공하지 않으면(예: waiting-room v0) 명확한 에러가 반환된다
