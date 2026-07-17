# dashboard

`services/` 아래 모든 실험을 한 화면에서 켜고 끌 수 있는 관리 UI. 서비스마다 탭이 하나씩 있고,
각 탭은 두 영역으로 나뉜다.

- **공통 영역** (dashboard가 직접 소유) — Up / Down / Status. 어떤 서비스든 Docker 컨테이너
  라이프사이클은 똑같으므로 여기서만 다룬다.
- **커스텀 패널** (서비스가 소유) — 서비스가 `forge-lab.json`에 `panelUrl`을 선언하면 그
  URL을 그대로 iframe으로 띄운다. dashboard는 그 페이지 안에서 뭘 하는지 전혀 모른다 — 대기열
  시각화든 다른 무엇이든 서비스가 알아서 만든다.

## 실행

```bash
npm install
npm run dev
# http://localhost:4000
```

호스트에 `docker`(compose v2 포함)가 설치되어 있어야 한다. 서비스 이미지 빌드에 필요한 비밀
(GitHub Packages 토큰 등)은 dashboard가 아니라 **각 서비스 디렉토리의 `.env` 파일**에 둔다
(`docker compose`가 컴포즈 파일이 있는 디렉토리 기준으로 `.env`를 자동으로 읽으므로, dashboard를
어디서 실행하든 별도 export가 필요 없다 — `services/waiting-room/README.md` 참고).

## 동작 방식

- `services/*/docker-compose.yml`이 있는 디렉토리를 서비스로 자동 인식한다 (`src/registry.ts`)
- `services/*/forge-lab.json`의 `panelUrl`을 읽어 탭 안에 iframe으로 띄운다 (없으면 안내 문구만 표시)
- Up/Down/Status는 `docker compose -f <서비스>/docker-compose.yml <명령>`을 그대로 실행한다

## 새 서비스를 dashboard에 연결하려면

1. `services/<name>/docker-compose.yml`을 만든다 (이것만으로 Up/Down/Status 탭에는 바로 뜬다)
2. 서비스 자체 UI가 필요하면 서비스가 정적 페이지를 서빙하고, `services/<name>/forge-lab.json`에
   `{ "panelUrl": "http://localhost:<port>/<page>" }`를 선언한다
