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

## 대시보드

`dashboard/`는 `services/` 아래 모든 실험을 한 화면에서 확인하기 위한 관리 UI다. 개별 실험의 비즈니스 로직을 갖지 않는다 — dashboard가 직접 소유하는 건 Up/Down/Status(Docker 라이프사이클, 모든 서비스에 공통)뿐이다.

서비스별로 다른 기능/화면(데이터 주입, 상태 시각화 등)은 dashboard 코드에 넣지 않는다. 대신 서비스가 자기 정적 페이지를 직접 서빙하고, `services/<name>/forge-lab.json`에 `{ "panelUrl": "http://localhost:<port>/<page>" }`를 선언하면 dashboard가 해당 서비스 탭 안에 iframe으로 그대로 띄운다. dashboard는 그 페이지 안에서 뭘 하는지 전혀 모른 채로 링크만 전달한다 — 새 실험을 추가할 때마다 dashboard 코드를 고칠 필요가 없게 하기 위함이다.
