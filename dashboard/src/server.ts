import { join } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { serviceRoutes } from "./routes/services";
import { docsRoutes } from "./routes/docs";

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  await app.register(fastifyStatic, {
    root: join(__dirname, "..", "public"),
    prefix: "/",
  });
  await app.register(serviceRoutes, { prefix: "/api" });
  await app.register(docsRoutes, { prefix: "/api" });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen({ port, host: "0.0.0.0" });
}

void main();
