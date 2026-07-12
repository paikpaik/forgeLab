# forge-lab — Claude AI Guidelines

## 프로젝트 개요

| 항목 | 내용 |
|------|------|
| 기술 스택 | TypeScript, npm workspaces, NestJS/Fastify, Redis, Docker |
| 역할 | `@paikpaik/node-forge`, `@paikpaik/kafka-forge`를 실제 npm 의존성으로 설치해서 여러 모노레포 아키텍처를 실험하는 랩 |

이 레포는 라이브러리가 아니라 **실험장**이다. `forge/` 아래에는 `node-forge`, `kafka-forge` 소스가 참고용으로 클론되어 있지만 (읽기 전용, git 추적 대상 아님), `services/`의 실험 코드는 반드시 GitHub Packages에서 `npm install @paikpaik/node-forge @paikpaik/kafka-forge`로 설치해서 진짜 소비자 입장으로 검증한다. 상대경로/workspace 참조로 `forge/` 소스를 직접 import하지 않는다.

---

## BOOT SEQUENCE

Claude는 작업 시작 전 아래 순서로 규칙서를 읽는다.

### 항상 적용

| 순서 | 규칙 | 내용 |
|------|------|------|
| 1 | `rules/common/principles.md` | 구조 결정은 임의로 하지 않기, forge 수정은 제안서로 |
| 2 | `rules/common/workflow.md` | 설계 확인 → `/harness-plans` → 구현 |

### 상황별 적용

| 상황 | 규칙 |
|------|------|
| 새 실험(서비스) 추가/구조 변경 | `rules/project/convention.md`, `.claude-plans/` |
| `node-forge`/`kafka-forge`에 없는 기능이 필요할 때 | `rules/project/convention.md`의 "제안서 규약" |

---

## 저장소 구조

```
forge-lab/
├── forge/                 node-forge, kafka-forge 참고용 클론 (읽기 전용, git 미추적)
├── proposals/             forge 패키지 확장/수정 제안서
├── services/              아키텍처 실험 (npm workspace 패키지, 실험당 1개)
│   └── waiting-room/      1번째 실험: 정렬셋 기반 가상 대기열 서버
├── dashboard/              전체 실험을 관리하는 UI (서버 실행, 데이터 주입 등)
├── docs/                   실험별 기록
└── forge-lab-plan.md       최초 기획 문서
```

---

## 핵심 규칙

- `forge/` 하위 소스는 코드를 그대로 가져다 쓰지 않는다 (참고/독해 전용). 필요한 기능은 `npm install`로 설치해서 쓴다.
- `node-forge`/`kafka-forge`에 수정이 필요하다고 판단되면 직접 고치지 않는다. `proposals/`에 제안서를 작성하고 사용자에게 알린다 — 실제 반영은 사용자가 각 forge 레포에서 진행한다.
- 저장소 구조, 워크스페이스 경계, 의존성 방향처럼 되돌리기 어려운 결정은 먼저 사용자와 확인한다.
