# forge-lab 프로젝트 컨벤션

## 실험 구조

각 아키텍처 실험은 `services/` 아래 독립된 npm workspace 패키지로 분리한다. 실험 간 코드를 직접 import하지 않는다 — 공유가 필요하면 forge 패키지로 올리거나(제안서 경유) 별도 공유 패키지를 신설한다(사용자 확인 후).

## forge 의존성

- `services/*/package.json`의 `dependencies`에 `@paikpaik/node-forge`, `@paikpaik/kafka-forge`를 GitHub Packages 레지스트리로 명시한다.
- `forge/node-forge`, `forge/kafka-forge`는 소스 독해용 참고 클론이다. workspace에 포함하지 않고, `.gitignore`로 forge-lab 자체 git 추적에서 제외한다.

## 제안서 규약 (`proposals/`)

```
proposals/
├── node-forge/
│   └── <YYYYMMDD>-<주제>.md
└── kafka-forge/
    └── <YYYYMMDD>-<주제>.md
```

제안서에는 다음을 포함한다: 어떤 실험(services/*)에서 어떤 니즈가 생겼는지, 현재 forge 패키지로 안 되는 이유, 제안하는 API/모듈 형태, 대안으로 검토했지만 기각한 방법.

## 패널 공유 UI

4개 실험이 각자 복붙해서 쓰던 카드/버튼/폼/로그/가이드 CSS와 로그 렌더링 JS는
`services/shared-panel-ui/`(`@forge-lab/panel-ui`, npm workspace 패키지)로 뽑는다.
`docker-compose.yml`이 없어서 대시보드 registry가 자동으로 서비스 탭 목록에서 제외한다.
각 서비스는 이 패키지를 `dependencies`에 추가하고, `main.ts`에서
`require.resolve("@forge-lab/panel-ui/package.json")`로 실제 위치를 찾아 `/shared/*`로
추가 마운트한다(호이스팅 위치에 상관없이 안전). `panel.html`은
`<link rel="stylesheet" href="/shared/panel-ui.css">` + `<script src="/shared/panel-ui.js">`로
참조하고, 서비스 고유 요소만 자체 `<style>`에 남긴다.

이 패키지를 Docker에서도 쓰려면 빌드 컨텍스트가 레포 루트여야 한다(`context: ../..`,
`dockerfile: services/<name>/Dockerfile`) — npm workspace 심볼릭 링크를 컨테이너 안에서
해석하려면 워크스페이스 루트 `package.json`이 빌드 컨텍스트 안에 있어야 하기 때문이다.
`.npmrc`(레지스트리 인증)는 반드시 워크스페이스 루트(`/app/.npmrc`)에 둔다 — npm이
워크스페이스 멤버 디렉토리 안의 `.npmrc`는 무시한다.

## Admin/Test API 네이밍

서비스의 핵심 도메인 API와 분리해서, 관리자/테스트 목적 엔드포인트(강제 리셋, 실패 유도,
DLQ/dead-letter 확인, 부하 테스트 정리 등)는 항상 `/admin/*` 프리픽스 아래 별도
`AdminController`로 둔다. 핵심 도메인 리소스의 CRUD(줄서기, 점수 이벤트 발행, 주문 생성,
체크아웃 등)는 프리픽스 없이 그대로 둔다 — `/admin/*`은 "실험을 운영/검증하는 사람을 위한
엔드포인트"만 표시하는 용도다.

| 무엇 | 경로 예시 |
|---|---|
| 도메인 리소스 강제 초기화/리셋 | `/admin/<resource>/reset` |
| 실패/격리된 레코드 확인 | `/admin/dlq`, `/admin/outbox/dead` |
| 테스트용 벌크 조작(부하 테스트 정리 등) | `/admin/<resource>/<action>` |

msa-checkout의 `/admin/inventory/:productId/reset`이 이 패턴의 원형이다.

## 대시보드

`dashboard/`는 `services/` 아래 모든 실험을 한 화면에서 확인하기 위한 관리 UI다. 개별 실험의 비즈니스 로직을 갖지 않는다 — dashboard가 직접 소유하는 건 Up/Down/Status(Docker 라이프사이클, 모든 서비스에 공통)뿐이다.

서비스별로 다른 기능/화면(데이터 주입, 상태 시각화 등)은 dashboard 코드에 넣지 않는다. 대신 서비스가 자기 정적 페이지를 직접 서빙하고, `services/<name>/forge-lab.json`에 `{ "panelUrl": "http://localhost:<port>/<page>" }`를 선언하면 dashboard가 해당 서비스 탭 안에 iframe으로 그대로 띄운다. dashboard는 그 페이지 안에서 뭘 하는지 전혀 모른 채로 링크만 전달한다 — 새 실험을 추가할 때마다 dashboard 코드를 고칠 필요가 없게 하기 위함이다.
