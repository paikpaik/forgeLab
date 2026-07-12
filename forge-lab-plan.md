# 프로젝트 계획: forge-lab (가칭)

## 레포 이름/설명 제안

- **이름**: `forge-lab`
- **설명 (영문)**: A monorepo for prototyping server architectures with node-forge and kafka-forge.
- **왜 이 이름인가**: `node-forge`/`kafka-forge`가 "재사용 가능한 부품"이라면, 이 레포는 그 부품들을 실제로 조립해보는 "실험실(lab)"이다. 부품 자체(라이브러리)와 실험(아키텍처 검증)의 역할을 이름에서부터 분리한다.

## 포지셔닝

`node-forge`(`@paikpaik/node-forge`)와 `kafka-forge`(`@paikpaik/kafka-forge`)는 각각 GitHub Packages에 실제로 배포된 독립 라이브러리다. 이 두 패키지를 **진짜 외부 의존성으로 설치해서** 여러 아키텍처를 실험하는 것이 이 레포의 목적이다. kafka-forge 자체 레포에서는 "라이브러리를 순수하게 유지"하기 위해 레퍼런스 서비스를 전부 걷어냈는데, 그 역할(실제로 써보면서 검증하기)을 여기서 node-forge까지 포함해 더 넓게 이어간다.

- 상대경로 import가 아니라 `npm install @paikpaik/node-forge @paikpaik/kafka-forge`로 **진짜 소비자 입장**에서 두 패키지를 검증
- 아키텍처 실험마다 별도 서비스로 분리 (npm workspaces)
- 이 과정에서 두 패키지에 실제로 부족한 기능이 드러나면, 각자의 레포로 돌아가 개선

## 구조 (초안)

```
forge-lab/
├── package.json          workspaces root
├── services/
│   └── waiting-room/      1번째 실험: 정렬셋 기반 가상 대기열 서버
└── docs/                  실험별 기록
```

## 1번째 실험: 정렬셋(Redis Sorted Set) 기반 가상 대기실

콘서트 예매/플래시세일 스타일 — 동시 접속자가 몰릴 때 실제 서비스(주문/결제 등) 앞단에서 순서대로만 입장시키는 시스템.

### 핵심 개념

- **대기 등록**: `ZADD waiting_queue <입장 요청 시각 or 단조증가 시퀀스> <userId>` — score가 "도착 순서"를 결정
- **내 순번 조회**: `ZRANK waiting_queue <userId>` — 사용자가 폴링하며 "몇 번째 대기 중"을 확인
- **입장 허용(admission)**: 서버가 주기적으로(또는 실제 서비스의 처리 가능 용량에 맞춰) `ZRANGE waiting_queue 0 N-1`로 상위 N명을 뽑아 입장 허용 처리 → `ZREM`으로 대기열에서 제거, 입장 토큰(JWT 등) 발급
- **동시성 문제**: 여러 admission 프로세스가 동시에 도는 경우 같은 사용자를 중복 허용하지 않도록 Lua 스크립트로 "조회+제거"를 원자적으로 묶어야 함 (Redis 트랜잭션/스크립팅 관련 실습 포인트)

### node-forge/kafka-forge를 어디에 쓸지 (아이디어, 확정 아님)

- **node-forge/redis**: ZSET 연산을 감싼 대기열 클라이언트
- **node-forge/response**: 대기 상태 조회 API의 표준 응답 포맷
- **node-forge/logger**, **node-forge/metrics**: 대기열 길이, 평균 대기 시간 등 관측
- **kafka-forge**: "입장 허용됨" 이벤트를 발행해서, 알림 서비스가 별도 프로세스로 "지금 입장 가능합니다" 알림을 처리하게 분리 — admission 로직과 알림 로직을 이벤트로 느슨하게 결합하는 아키텍처 실험

### 스코프

**이번에 다룸**
- 단일 Redis 인스턴스 기준 정확한 순서 보장
- admission 동시성 제어 (Lua 스크립트)
- 대기열 관측 (길이, 평균 대기 시간)

**일단 스코프 아웃**
- 분산 환경에서의 순서 보장
- 결제/주문 연동 실제 로직 (대기열 자체의 정확성에 집중)

## 다음 단계

1. GitHub에 `forge-lab` 레포 생성
2. 이 문서를 레포에 추가 (`README.md` 또는 `docs/plan.md`)
3. 이 문서를 기반으로 로컬 구조 세팅 요청 → Redis(로컬 Docker) + `waiting-room` 서비스 스캐폴딩부터 시작
