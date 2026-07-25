-- 도메인 서비스별로 DB를 분리한다(진짜 MSA면 DB도 분리) — 컨테이너 하나 안에서 database만
-- 나누는 랩 전용 타협. 서비스 간 직접 SQL 조인은 하지 않는다는 원칙만 지킨다.
CREATE DATABASE order_db;
CREATE DATABASE inventory_db;
CREATE DATABASE saga_db;
