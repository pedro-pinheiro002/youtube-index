import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  applyPgSchema,
  closePgPool,
  createPgPool,
  PostgresLedger,
  type IngestionQueue,
  type Job,
  type Pool,
} from "@youtube-index/domain";
import { makeConfig, makeSearchClient, makeYouTubeClient } from "./helpers.js";

/**
 * Teste de integração HTTP-level do slice #48 (Postgres como único
 * backend). Pré-requisito: um Postgres acessível em DATABASE_URL
 * (padrão postgres://postgres:postgres@localhost:5432/youtube_index).
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/youtube_index";

function makeStubQueue(): IngestionQueue {
  let nextId = 1;
  return {
    enqueue: async (channelId: string): Promise<Job> => ({
      id: nextId++,
      channelId,
      status: "queued",
      createdAt: new Date().toISOString(),
    }),
    claimNext: async () => null,
    complete: async () => undefined,
    fail: async () => undefined,
    listJobs: async () => [],
  };
}

let pool: Pool;

beforeAll(async () => {
  pool = createPgPool({ databaseUrl: DATABASE_URL });
  await applyPgSchema(pool);
});

afterAll(async () => {
  await closePgPool(pool);
});

describe("GET /health", () => {
  it("responde com status ok", async () => {
    const app = buildApp(makeConfig(), {
      ledger: new PostgresLedger(pool),
      queue: makeStubQueue(),
      youtube: makeYouTubeClient(),
      search: makeSearchClient(),
    });

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("rota desconhecida responde 404 quando sem frontend estático", async () => {
    const app = buildApp(makeConfig(), {
      ledger: new PostgresLedger(pool),
      queue: makeStubQueue(),
      youtube: makeYouTubeClient(),
      search: makeSearchClient(),
    });

    const res = await app.inject({ method: "GET", url: "/nao-existe" });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});