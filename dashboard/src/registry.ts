import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ServiceInfo {
  name: string;
  dir: string;
  composeFile: string;
  /** 서비스가 forge-lab.json에 선언한, 실시간 상태를 볼 수 있는 조회용 URL (선택) */
  watchUrl?: string;
}

/**
 * src/에서도 dist/에서도 동일하게 한 단계 위가 dashboard/, 그 위가 forge-lab/이므로
 * __dirname 기준 상대 경로가 실행 방식(ts-node-dev vs 빌드된 node)에 무관하게 일치한다.
 */
const SERVICES_ROOT = process.env.SERVICES_ROOT ?? join(__dirname, "..", "..", "services");

/**
 * 서비스 디렉토리의 forge-lab.json에서 watchUrl을 읽는다. dashboard는 이 URL이 뭘
 * 의미하는지 모른다 — 그냥 프론트엔드가 폴링할 링크로만 그대로 전달한다 (도메인 로직은
 * 항상 서비스 쪽 책임으로 남긴다).
 */
function readWatchUrl(serviceDir: string): string | undefined {
  const configFile = join(serviceDir, "forge-lab.json");
  if (!existsSync(configFile)) return undefined;

  try {
    const config = JSON.parse(readFileSync(configFile, "utf8")) as { watchUrl?: unknown };
    return typeof config.watchUrl === "string" ? config.watchUrl : undefined;
  } catch {
    return undefined;
  }
}

export function listServices(): ServiceInfo[] {
  if (!existsSync(SERVICES_ROOT)) return [];

  return readdirSync(SERVICES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join(SERVICES_ROOT, entry.name);
      return {
        name: entry.name,
        dir,
        composeFile: join(dir, "docker-compose.yml"),
        watchUrl: readWatchUrl(dir),
      };
    })
    .filter((service) => existsSync(service.composeFile));
}

export function getService(name: string): ServiceInfo | undefined {
  return listServices().find((service) => service.name === name);
}
