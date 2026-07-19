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
