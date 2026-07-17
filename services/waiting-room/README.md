# waiting-room

정렬셋(Redis Sorted Set) 기반 가상 대기열 서버. `@paikpaik/node-forge`를 실 소비자로 검증하는
forge-lab의 1번째 실험이다.

## 실행

```bash
# GitHub Packages 인증 토큰 (node-forge/kafka-forge를 설치할 수 있는 PAT, read:packages 스코프)
export NODE_AUTH_TOKEN=ghp_xxx

docker compose up --build -d
```

토큰은 Dockerfile에서 BuildKit `--mount=type=secret`으로만 잠깐 마운트되고 이미지 레이어·빌드
로그에는 남지 않는다 (`docker history`로 확인 가능). `ARG`로 토큰을 넘기면 빌드 로그에 평문으로
찍히니 이 패턴을 다른 서비스에도 그대로 따라간다.

## API

```bash
# 대기 등록
curl -X POST localhost:3000/rooms/default/waiting-users \
  -H 'content-type: application/json' -d '{"userId":"u1"}'

# 내 순번 조회
curl localhost:3000/rooms/default/waiting-users/u1

# 헬스체크 / 메트릭
curl localhost:3000/health
curl localhost:3000/metrics
```

admission은 `ADMISSION_INTERVAL_MS`(기본 5초)마다 서버 내부 스케줄러가 자동으로 상위
`ADMISSION_BATCH_SIZE`명을 입장 허용 처리한다 — 별도로 트리거할 API는 없다.

## 대기열 패널

`http://localhost:3000/panel.html` — 브라우저에서 직접 열면 실제 대기열처럼 내 순번과 전체
대기열을 실시간으로 볼 수 있다. "줄서기"로 직접 등록해보거나, 인원수/분산시간을 넣고 한 번에
몰아서 등록해 콘서트 예매 같은 버스트 상황을 재현할 수 있다. `dashboard`(`../../dashboard`)를
실행하면 waiting-room 탭 안에 이 패널이 그대로 embed된다 (`forge-lab.json`의 `panelUrl`).

CLI로 같은 걸 하고 싶으면(브라우저 없이):
```bash
docker compose exec -T -e SEED_COUNT=30 -e SEED_DURATION_MS=2000 app npm run seed
```

## 스코프

이번 실험은 단일 room(`ROOM_ID`), 단일 인스턴스를 전제로 한다. 멀티룸 스케줄링,
kafka-forge 입장 이벤트 발행, 다중 인스턴스 admission 조율은 다루지 않는다
(`.claude-plans/20260712/waiting-room-queue-logic.md` 참고).

## 로컬 개발 (Docker 없이)

```bash
npm install
redis-server &   # 또는 docker run -p 6379:6379 redis:7-alpine
cp .env.example .env
npm run start:dev
```
