import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import type { AppConfig } from "./config.js";
import { registerChannelRoutes } from "./channels.js";
import { registerSearchRoutes } from "./search.js";
import type { IngestionQueue, Ledger, PhaseMeta, SearchPort, YouTubeClient } from "@youtube-index/domain";

export interface AppDeps {
  ledger: Ledger;
  queue: IngestionQueue;
  youtube: YouTubeClient;
  search: SearchPort;
}

export function buildApp(
  config: AppConfig,
  deps: AppDeps,
  phases?: readonly PhaseMeta[],
): FastifyInstance {
  const app = Fastify({ logger: config.logger });

  app.get("/health", async () => ({ status: "ok" }));

  void registerChannelRoutes(app, deps);
  void registerSearchRoutes(app, deps, phases);

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