import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  ChannelNotFoundError,
  applyPgSchema,
  closePgPool,
  createPgPool,
  PostgresLedger,
  type IngestionQueue,
  type Job,
  type Pool,
  type YouTubeClient,
} from "@youtube-index/domain";
import { makeConfig, makeSearchClient, makeYouTubeClient } from "./helpers.js";

/**
 * Teste de integração HTTP-level do slice #48 (Postgres como único
 * backend): o `PostgresLedger` roda contra um Postgres real. A fila é
 * um stub em memória que registra os jobs enfileirados pela rota
 * POST /channels — estes testes validam o comportamento HTTP do Canal,
 * não o backend da fila.
 *
 * Pré-requisito: um Postgres acessível em DATABASE_URL (padrão
 * postgres://postgres:postgres@localhost:5432/youtube_index).
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/youtube_index";

const CHANNEL_ID = "UCY8iijN1AkyDCh1Z9akcqUA";

// Stub da fila que guarda os jobs em memória para preservar as
// asserções de `listJobs` dos testes originais (POST enfileira o job).
function makeStubQueue(): IngestionQueue {
  let nextId = 1;
  const jobs: Job[] = [];
  return {
    enqueue: async (channelId: string): Promise<Job> => {
      const job: Job = {
        id: nextId++,
        channelId,
        status: "queued",
        createdAt: new Date().toISOString(),
      };
      jobs.push(job);
      return job;
    },
    claimNext: async () => null,
    complete: async () => undefined,
    fail: async () => undefined,
    listJobs: async (channelId: string) => jobs.filter((j) => j.channelId === channelId),
  };
}

let pool: Pool;

beforeAll(async () => {
  pool = createPgPool({ databaseUrl: DATABASE_URL });
  await applyPgSchema(pool);
});

afterAll(async () => {
  await pool.query("DELETE FROM channels WHERE id = $1", [CHANNEL_ID]);
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

describe("POST /channels", () => {
  it("resolve o handle, cria o Canal no Postgres e enfileira um job", async () => {
    const ledger = new PostgresLedger(pool);
    const queue = makeStubQueue();
    const youtube = makeYouTubeClient({ channelId: CHANNEL_ID, title: "Funky Black Cat" });
    const app = buildApp(makeConfig(), { ledger, queue, youtube, search: makeSearchClient() });

    const res = await app.inject({
      method: "POST",
      url: "/channels",
      payload: { handle: "@funkyblackcat" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      id: CHANNEL_ID,
      handle: "@funkyblackcat",
      title: "Funky Black Cat",
      status: "queued",
    });

    const channel = await ledger.getChannel(CHANNEL_ID);
    expect(channel?.phases.videos.status).toBe("pending");
    expect(await queue.listJobs(CHANNEL_ID)).toHaveLength(1);
    await app.close();
  });

  it("responde 201 criando o Canal mesmo quando o handle já foi resolvido antes", async () => {
    const ledger = new PostgresLedger(pool);
    const queue = makeStubQueue();
    const youtube = makeYouTubeClient();
    const app = buildApp(makeConfig(), { ledger, queue, youtube, search: makeSearchClient() });

    const first = await app.inject({
      method: "POST",
      url: "/channels",
      payload: { handle: "@funkyblackcat" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/channels",
      payload: { handle: "@funkyblackcat" },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toMatchObject({ id: CHANNEL_ID });
    expect(await queue.listJobs(CHANNEL_ID)).toHaveLength(2);
    await app.close();
  });

  it("responde 404 quando o handle não é resolvido", async () => {
    const youtube: YouTubeClient = {
      resolveHandle: async () => {
        throw new ChannelNotFoundError("@nao-existe");
      },
      getUploadsPlaylistId: async () => {
        throw new Error("não usado neste teste");
      },
      listUploads: async () => {
        throw new Error("não usado neste teste");
      },
      getVideoStats: async () => {
        throw new Error("não usado neste teste");
      },
      listComments: async () => {
        throw new Error("não usado neste teste");
      },
    };
    const app = buildApp(makeConfig(), {
      ledger: new PostgresLedger(pool),
      queue: makeStubQueue(),
      youtube,
      search: makeSearchClient(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/channels",
      payload: { handle: "@nao-existe" },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("GET /channels/:id", () => {
  it("devolve o Canal com status e progresso por Fase", async () => {
    const ledger = new PostgresLedger(pool);
    const app = buildApp(makeConfig(), {
      ledger,
      queue: makeStubQueue(),
      youtube: makeYouTubeClient(),
      search: makeSearchClient(),
    });
    await ledger.createChannel({
      channelId: CHANNEL_ID,
      handle: "@funkyblackcat",
      title: "Funky Black Cat",
    });

    const res = await app.inject({ method: "GET", url: `/channels/${CHANNEL_ID}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: CHANNEL_ID,
      status: "queued",
      phases: {
        videos: { phase: "videos", status: "pending", done: 0, total: null },
        comments: { phase: "comments", status: "pending", done: 0, total: null },
        transcripts: { phase: "transcripts", status: "pending", done: 0, total: null },
      },
    });
    await app.close();
  });

  it("devolve 404 para um channelId desconhecido", async () => {
    const app = buildApp(makeConfig(), {
      ledger: new PostgresLedger(pool),
      queue: makeStubQueue(),
      youtube: makeYouTubeClient(),
      search: makeSearchClient(),
    });

    const res = await app.inject({ method: "GET", url: "/channels/desconhecido" });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});