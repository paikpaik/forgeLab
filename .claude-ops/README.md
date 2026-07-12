# .claude-ops — forge-lab 규칙서 형상 관리

`.claude/` 규칙서를 안전하게 바꾸기 위한 백업/검증/동기화 워크플로우 저장소.

## 폴더 구조

```
.claude-ops/
├── backups/YYYYMMDD[_N]/   .claude/ 스냅샷 (변경 전 백업)
├── updates/YYYYMMDD/        update.md 체인 (변경 배경, 검증 이력)
└── work/                    .claude/의 작업용 사본 (검증 완료 후 여기 반영)
```

## 날짜 폴더 규칙

같은 날 여러 번 작업하면 `YYYYMMDD_1`, `YYYYMMDD_2`처럼 순번을 붙인다.

## 업데이트 워크플로우

1. `backup` — 현재 `.claude/`를 `backups/`에 스냅샷
2. `work/` 최신화 — `.claude/`를 `work/`로 복사
3. `update.md` 작성 — 무엇을, 왜 바꾸는지 기록
4. 검증 — 이전 update 체인과 대조해서 이상 없는지 확인, 문제 있으면 다음 순번 update 파일에 기록
5. `work/` 반영 — 검증 완료된 내용을 `work/`에 반영
6. `.claude/` 동기화 — `work/`를 `.claude/`로 복사

## update 체인 작성 원칙

- 매 update.md는 "왜 필요한가"를 먼저 쓴다 (반복된 실수, 새 패턴, 방법론 변경 등)
- 이전 update를 참조할 땐 파일명을 명시한다
- 검증 결과는 대화로만 끝내지 않고, 검증할 내용이 있으면 반드시 다음 순번 파일에 남긴다
