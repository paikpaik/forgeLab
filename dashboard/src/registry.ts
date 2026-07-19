import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ServiceInfo {
  name: string;
  dir: string;
  composeFile: string;
  /** 서비스가 forge-lab.json에 선언한, 자기 전용 UI를 보여줄 페이지 URL (선택) */
  panelUrl?: string;
  /** 서비스가 forge-lab.json에 선언한, 자기 아키텍처 문서의 절대 경로 (선택) */
  architectureDocPath?: string;
}

interface ForgeLabConfig {
  panelUrl?: unknown;
  architectureDoc?: unknown;
}

/**
 * src/에서도 dist/에서도 동일하게 한 단계 위가 dashboard/, 그 위가 forge-lab/이므로
 * __dirname 기준 상대 경로가 실행 방식(ts-node-dev vs 빌드된 node)에 무관하게 일치한다.
 */
const SERVICES_ROOT = process.env.SERVICES_ROOT ?? join(__dirname, "..", "..", "services");

/**
 * 서비스 디렉토리의 forge-lab.json을 읽는다. dashboard는 panelUrl/architectureDoc이 뭘
 * 보여주는지 전혀 모른다 — panelUrl은 iframe으로 그대로 띄우고, architectureDoc은 파일을
 * 읽어서 그대로 반환할 링크로만 다룬다. 서비스별 UI/문서 차이는 여기서 흡수하지 않고 각
 * 서비스가 자기 쪽에서 알아서 관리한다.
 */
function readForgeLabConfig(serviceDir: string): ForgeLabConfig {
  const configFile = join(serviceDir, "forge-lab.json");
  if (!existsSync(configFile)) return {};

  try {
    return JSON.parse(readFileSync(configFile, "utf8")) as ForgeLabConfig;
  } catch {
    return {};
  }
}

function resolveArchitectureDocPath(serviceDir: string, config: ForgeLabConfig): string | undefined {
  if (typeof config.architectureDoc !== "string" || config.architectureDoc.includes("..")) {
    return undefined;
  }
  const filePath = join(serviceDir, config.architectureDoc);
  return existsSync(filePath) ? filePath : undefined;
}

export function listServices(): ServiceInfo[] {
  if (!existsSync(SERVICES_ROOT)) return [];

  return readdirSync(SERVICES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join(SERVICES_ROOT, entry.name);
      const config = readForgeLabConfig(dir);
      return {
        name: entry.name,
        dir,
        composeFile: join(dir, "docker-compose.yml"),
        panelUrl: typeof config.panelUrl === "string" ? config.panelUrl : undefined,
        architectureDocPath: resolveArchitectureDocPath(dir, config),
      };
    })
    .filter((service) => existsSync(service.composeFile));
}

export function getService(name: string): ServiceInfo | undefined {
  return listServices().find((service) => service.name === name);
}
