import type { FastifyInstance } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * dashboard/src/routes에서 3단계 위(dashboard/, forge-lab/)가 docs/다.
 * src/에서도 dist/에서도 같은 상대 깊이라 실행 방식과 무관하게 일치한다.
 */
const DOCS_ROOT = process.env.DOCS_ROOT ?? join(__dirname, "..", "..", "..", "docs");

/**
 * dashboard는 문서 내용을 전혀 해석하지 않고 파일을 그대로 읽어서 돌려준다 — 렌더링(마크다운
 * + mermaid)은 프론트엔드가 담당한다. 서비스별 panelUrl과 동일한 "내용은 모르고 전달만 한다"
 * 원칙을 문서 뷰어에도 그대로 적용한 것.
 */
export async function docsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { name: string } }>("/docs/:name", async (req, reply) => {
    const { name } = req.params;
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return reply.code(400).send({ error: "잘못된 문서 이름입니다" });
    }

    const filePath = join(DOCS_ROOT, `${name}.md`);
    if (!existsSync(filePath)) {
      return reply.code(404).send({ error: `문서를 찾을 수 없습니다: ${name}` });
    }

    return { content: readFileSync(filePath, "utf8") };
  });
}
