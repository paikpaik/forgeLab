import { readFileSync } from "node:fs";
import type { FastifyInstance, FastifyReply } from "fastify";
import { getService, listServices } from "../registry";
import { composeDown, composeStatus, composeUp } from "../docker-compose";

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
    listServices().map((s) => ({
      name: s.name,
      panelUrl: s.panelUrl,
      hasArchitectureDoc: Boolean(s.architectureDocPath),
    })),
  );

  app.get<{ Params: { name: string } }>("/services/:name/architecture", async (req, reply) => {
    const service = requireService(req.params.name, reply);
    if (!service) return;
    if (!service.architectureDocPath) {
      return reply.code(404).send({ error: `${req.params.name}에는 아키텍처 문서가 없습니다` });
    }
    return { content: readFileSync(service.architectureDocPath, "utf8") };
  });

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
}
