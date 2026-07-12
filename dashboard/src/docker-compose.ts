import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * 서비스 이름은 사용자 입력(URL 파라미터)에서 오므로, 문자열을 셸에 조합하지 않고
 * execFile로 인자를 배열째 넘긴다 (커맨드 인젝션 방지).
 */
async function runCompose(composeFile: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync("docker", ["compose", "-f", composeFile, ...args]);
  return stdout || stderr;
}

export function composeUp(composeFile: string): Promise<string> {
  return runCompose(composeFile, ["up", "-d", "--build"]);
}

export function composeDown(composeFile: string): Promise<string> {
  return runCompose(composeFile, ["down"]);
}

export function composeStatus(composeFile: string): Promise<string> {
  return runCompose(composeFile, ["ps", "--format", "json"]);
}

/**
 * 서비스 쪽 컨테이너가 `app`이라는 이름을 갖고, `npm run seed` 스크립트를 제공한다는 컨벤션.
 * 스크립트가 아직 없는 서비스(예: waiting-room v0)는 여기서 명확한 에러로 실패한다 —
 * 조용히 넘어가지 않고 원인이 드러나야 한다는 원칙. `env`는 seed 스크립트에 전달할
 * 파라미터(예: 인원 수, 분산 시간)를 `-e KEY=VALUE` 형태로 넘긴다 — 이 값들의 의미도
 * dashboard는 모른다, 그냥 서비스가 정의한 이름 그대로 전달할 뿐이다.
 */
export function composeSeed(composeFile: string, env: Record<string, string> = {}): Promise<string> {
  const envArgs = Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
  return runCompose(composeFile, ["exec", "-T", ...envArgs, "app", "npm", "run", "seed"]);
}
