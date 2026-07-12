// 콘서트 예매/플래시세일처럼 짧은 시간에 등록 요청이 몰리는 상황을 흉내낸다.
// SEED_COUNT명을 SEED_DURATION_MS 동안 고르게 분산해서 "동시에" 쏜다 (요청 하나가
// 끝나길 기다렸다가 다음을 보내는 순차 방식이 아니라 Promise.allSettled로 겹쳐서 보낸다).
// SEED_DURATION_MS=0이면 전부 한 번에 몰아서 보낸다 (순수 버스트).
const COUNT = Number(process.env.SEED_COUNT ?? 50);
const DURATION_MS = Number(process.env.SEED_DURATION_MS ?? 0);
const BASE_URL = process.env.SEED_BASE_URL ?? "http://localhost:3000";
const ROOM_ID = process.env.ROOM_ID ?? "default";

function registerUser(userId) {
  return fetch(`${BASE_URL}/rooms/${ROOM_ID}/waiting-users`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId }),
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const jobs = [];
  for (let i = 0; i < COUNT; i++) {
    const userId = `seed-${Date.now()}-${i}`;
    const scheduledAt = DURATION_MS > 0 ? (DURATION_MS * i) / COUNT : 0;
    jobs.push(delay(scheduledAt).then(() => registerUser(userId)));
  }

  const results = await Promise.allSettled(jobs);
  const ok = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
  const failed = results.length - ok;

  console.log(
    `대기열 등록 완료: ${ok}/${COUNT}명 성공${failed > 0 ? `, ${failed}명 실패` : ""} (${DURATION_MS}ms에 걸쳐 분산)`,
  );

  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
