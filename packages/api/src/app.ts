import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import type { AppConfig } from "./config.js";

export function buildApp(config: AppConfig): FastifyInstance {
  const app = Fastify({ logger: config.logger });

  app.get("/health", async () => ({ status: "ok" }));

  if (config.webDistDir && existsSync(config.webDistDir)) {
    void app.register(fastifyStatic, { root: config.webDistDir });

    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && request.headers.accept?.includes("text/html")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not Found" });
    });
  }

  return app;
}