import type { FastifyInstance, FastifyReply } from "fastify";
import { getService, listServices } from "../registry";
import { composeDown, composeSeed, composeStatus, composeUp } from "../docker-compose";

function requireService(name: string, reply: FastifyReply) {
  const service = getService(name);
  if (!service) {
    reply.code(404).send({ error: `등록된 서비스가 아닙니다: ${name}` });
    return null;
  }
  return service;
}

export async function serviceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/services", async () =>
    listServices().map((s) => ({ name: s.name, watchUrl: s.watchUrl })),
  );

  app.get<{ Params: { name: string } }>("/services/:name/status", async (req, reply) => {
    const service = requireService(req.params.name, reply);
    if (!service) return;
    try {
      return { output: await composeStatus(service.composeFile) };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { name: string } }>("/services/:name/up", async (req, reply) => {
    const service = requireService(req.params.name, reply);
    if (!service) return;
    try {
      return { output: await composeUp(service.composeFile) };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { name: string } }>("/services/:name/down", async (req, reply) => {
    const service = requireService(req.params.name, reply);
    if (!service) return;
    try {
      return { output: await composeDown(service.composeFile) };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { name: string }; Body: { count?: number; durationMs?: number } }>(
    "/services/:name/seed",
    async (req, reply) => {
      const service = requireService(req.params.name, reply);
      if (!service) return;

      const { count, durationMs } = req.body ?? {};
      const env: Record<string, string> = {};
      if (Number.isFinite(count)) env.SEED_COUNT = String(count);
      if (Number.isFinite(durationMs)) env.SEED_DURATION_MS = String(durationMs);

      try {
        return { output: await composeSeed(service.composeFile, env) };
      } catch (err) {
        return reply.code(502).send({ error: `seed 실행 실패: ${(err as Error).message}` });
      }
    },
  );
}
