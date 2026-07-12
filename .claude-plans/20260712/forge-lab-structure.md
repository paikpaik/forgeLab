# forge-lab-structure — waiting-room(NestJS) + dashboard(Docker Compose 오케스트레이션) 초기 스캐폴딩

## 목표

forge-lab에 첫 아키텍처 실험인 `waiting-room`(정렬셋 기반 가상 대기열, NestJS)의 실행 가능한 골격과, 이를 포함한 모든 실험을 한 화면에서 실행/중지/데이터 주입할 수 있는 `dashboard`의 초기 골격을 만든다. 대기열 자체의 비즈니스 로직(ZADD/ZRANK/admission)은 이번 스코프에 포함하지 않는다 — 골격이 dashboard를 통해 끝까지 동작하는 것을 먼저 확인한 뒤 별도 플랜으로 진행한다.

## 현재 상태 (AS-IS)

```
forge-lab/
├── package.json          workspaces: ["services/*", "dashboard"] (생성됨, 내용 없음)
├── .npmrc                 @paikpaik → GitHub Packages (생성됨)
├── .gitignore             /forge/, node_modules/, dist/ 등
├── forge/                 node-forge, kafka-forge 참고용 클론 (git 미추적)
├── proposals/              node-forge/, kafka-forge/ 빈 디렉토리
├── services/               빈 디렉토리
├── dashboard/               빈 디렉토리
├── docs/                    빈 디렉토리
└── .claude/, .claude-ops/  harness 시스템 (셋업 완료)
```

`services/waiting-room`, `dashboard`는 아직 파일이 없다.

## 변경 후 상태 (TO-BE)

```
forge-lab/
├── services/
│   └── waiting-room/
│       ├── package.json          NestJS, @paikpaik/node-forge(GitHub Packages) 의존
│       ├── tsconfig.json
│       ├── Dockerfile
│       ├── docker-compose.yml    app(NestJS) + redis
│       ├── .env.example
│       ├── src/
│       │   ├── main.ts
│       │   ├── app.module.ts
│       │   └── health/
│       │       ├── health.module.ts
│       │       └── health.controller.ts   GET /health → { status: "ok" }
│       └── README.md              직접 실행 방법, 다음 단계(큐 로직은 별도 플랜)
└── dashboard/
    ├── package.json               Fastify(경량 관리 API) + 정적 프론트
    ├── tsconfig.json
    ├── src/
    │   ├── server.ts               Fastify 부트스트랩
    │   ├── registry.ts             services/*/docker-compose.yml 스캔 → 서비스 목록
    │   └── routes/
    │       └── services.ts         GET /services, POST /services/:name/up|down|seed
    ├── public/
    │   └── index.html               바닐라 JS. 서비스 목록 + 상태 + up/down/seed 버튼
    └── README.md
```

## 변경 범위

| 파일 | 변경 내용 |
|------|----------|
| `services/waiting-room/package.json` | 신규. NestJS 최소 의존성 + `@paikpaik/node-forge` |
| `services/waiting-room/src/main.ts` | 신규. NestFactory 부트스트랩, PORT 환경변수 |
| `services/waiting-room/src/app.module.ts` | 신규. HealthModule만 import |
| `services/waiting-room/src/health/*` | 신규. `GET /health` 최소 엔드포인트 (node-forge `response/nestjs` 표준 응답 포맷 사용) |
| `services/waiting-room/Dockerfile` | 신규. 멀티스테이지 빌드 (build → run) |
| `services/waiting-room/docker-compose.yml` | 신규. `app`(빌드된 이미지), `redis`(alpine) 두 서비스 |
| `dashboard/package.json` | 신규. Fastify + 정적 파일 서빙 |
| `dashboard/src/registry.ts` | 신규. `services/` 하위 `docker-compose.yml` 존재하는 디렉토리를 서비스로 인식 |
| `dashboard/src/routes/services.ts` | 신규. `docker compose -f services/<name>/docker-compose.yml up/down -d`, 상태는 `docker compose ps --format json` 파싱 |
| `dashboard/public/index.html` | 신규. 서비스 카드 목록 UI (React 아님 — v0는 바닐라로 최소 구현) |
| `package.json` (root) | 수정 없음 (workspaces 설정은 이미 반영됨) — `npm install`로 두 워크스페이스 연결 확인만 |

## 영향성

| 영향 대상 | 영향 내용 |
|-----------|----------|
| `forge/` (참고용 클론) | 변경 없음. import 대상 아님 |
| `proposals/` | 변경 없음. 이번 스코프에서 forge 수정 필요 발견 시 별도로 작성 |
| 기존 커밋 이력 | 없음 (이번이 첫 구조화 커밋) |

## Breaking Changes

없음 (신규 생성).

## 위험도

**LOW** — 신규 파일 생성 위주, 기존 동작하는 코드가 없어 회귀 위험 없음. 다만 "데이터 주입(seed)" 규약은 이번엔 인터페이스만 잡고 실제 seed 스크립트는 다음 실험(대기열 로직) 플랜에서 채운다.

## 주의사항

- `services/waiting-room`의 `@paikpaik/node-forge`는 `.npmrc`를 통해 GitHub Packages에서 실제로 설치되어야 한다 — 로컬 `forge/node-forge` 소스를 상대경로로 참조하지 않는다.
- dashboard의 `docker compose` 호출은 `child_process`로 셸 커맨드를 실행하므로, 서비스 이름을 사용자 입력으로 받는 경우 인자 목록 형태(`execFile`)로 넘기고 문자열 조합으로 셸에 넘기지 않는다 (커맨드 인젝션 방지).
- seed 라우트(`POST /services/:name/seed`)는 이번 플랜에서 인터페이스(엔드포인트, 서비스 쪽 `docker compose exec app npm run seed` 컨벤션)만 정의하고, `npm run seed` 스크립트 본체는 대기열 로직 플랜에서 구현한다. 그때까지는 스크립트가 없다는 명확한 에러를 반환한다.

## 작업 단계

### 1단계: waiting-room NestJS 골격

1. `services/waiting-room/package.json` 작성 — `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`(또는 fastify 어댑터), `@paikpaik/node-forge`, `reflect-metadata`, `rxjs`
2. `tsconfig.json`, `src/main.ts`, `src/app.module.ts`, `src/health/*` 작성
3. `Dockerfile`(멀티스테이지), `docker-compose.yml`(app + redis), `.env.example` 작성
4. `README.md`에 `docker compose up --build` 실행법과 `curl localhost:<port>/health` 확인법 기록

### 2단계: dashboard 골격

1. `dashboard/package.json` 작성 — Fastify, `@fastify/static`
2. `src/registry.ts` — `services/` 스캔 로직
3. `src/routes/services.ts` — up/down/status/seed 라우트 (seed는 스텁)
4. `public/index.html` — 서비스 카드 목록, 버튼 클릭 시 fetch로 라우트 호출
5. `README.md`에 실행법(`npm run dev` 등) 기록

### 3단계: 루트 연결 확인

1. `npm install` (workspaces 전체 설치, `@paikpaik/node-forge` GitHub Packages 인증 필요 — 사용자 로컬 `~/.npmrc`의 토큰 확인)
2. 사용자가 직접 `docker compose`/dashboard 실행해서 동작 확인 (아래 검증 방법 참고)

## 검증 방법

1. `services/waiting-room`에서 `docker compose up --build -d` → `curl localhost:<port>/health`가 `{ "status": "ok" }` 형태 응답(node-forge 표준 응답 포맷) 반환
2. `dashboard`에서 `npm run dev` → 브라우저에서 서비스 카드에 `waiting-room` 노출 확인
3. 대시보드 UI에서 up 버튼 클릭 → `services/waiting-room` 컨테이너 기동 확인 (`docker compose -f services/waiting-room/docker-compose.yml ps`)
4. down 버튼 클릭 → 컨테이너 정지 확인
5. seed 버튼 클릭 → 아직 스크립트 없음을 알리는 명확한 에러 응답 확인 (500이 아니라 의미있는 메시지)

## 참조 규칙

- `.claude/rules/project/convention.md` — forge 의존성은 GitHub Packages 설치, 대시보드는 오케스트레이션 전담(비즈니스 로직 없음)
- `.claude/rules/common/principles.md` — 이번 스코프 외 기능(대기열 로직, 두 번째 실험 공통화) 미리 만들지 않음
- `.claude/rules/common/workflow.md` — forge 수정 필요 발견 시 구현 중단하고 `proposals/`부터 작성
