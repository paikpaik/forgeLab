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

`dashboard/`는 `services/` 아래 모든 실험을 한 화면에서 확인하기 위한 관리 UI다. 개별 실험의 비즈니스 로직을 갖지 않고, 각 서비스의 실행/중지, 데이터 주입 같은 운영 동작을 오케스트레이션하는 역할만 맡는다.
