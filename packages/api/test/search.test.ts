import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  applyPgSchema,
  closePgPool,
  createPgPool,
  PostgresLedger,
  type IngestionQueue,
  type Job,
  type PhaseMeta,
  type Pool,
  type SearchResponse,
} from "@youtube-index/domain";
import { makeConfig, makeSearchClient, makeYouTubeClient } from "./helpers.js";

/**
 * Teste de integração HTTP-level do slice #48 (Postgres como único
 * backend): o `PostgresLedger` semeia o Canal num Postgres real e o
 * `makeSearchClient` é um stub de SearchPort — estes testes validam o
 * comportamento HTTP do GET /search, sem acionar uma projeção de busca
 * real.
 *
 * Pré-requisito: um Postgres acessível em DATABASE_URL (padrão
 * postgres://postgres:postgres@localhost:5432/youtube_index).
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/youtube_index";

const CHANNEL_ID = "UCY8iijN1AkyDCh1Z9akcqUA";

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

function makeResults(): SearchResponse {
  return {
    hits: [
      {
        id: "v1",
        channelId: CHANNEL_ID,
        type: "video",
        title: "Primeiro vídeo",
        description: "Descrição",
        views: 100,
        likes: 10,
        durationSeconds: 120,
        url: "https://www.youtube.com/watch?v=v1",
        thumbnail: "https://i.ytimg.com/vi/v1/hqdefault.jpg",
        publishedAt: "2023-01-01T00:00:00Z",
        _formatted: { title: "Primeiro <em>vídeo</em>" },
      },
    ],
    total: 1,
    query: "vídeo",
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

describe("GET /search", () => {
  it("passa a Busca para o Meilisearch e devolve Vídeos com highlight", async () => {
    const ledger = new PostgresLedger(pool);
    await ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
    const search = makeSearchClient(makeResults());
    const app = buildApp(makeConfig(), { ledger, queue: makeStubQueue(), youtube: makeYouTubeClient(), search });

    const res = await app.inject({ method: "GET", url: `/search?q=vídeo&channelId=${CHANNEL_ID}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(makeResults());
    expect(search.calls).toEqual([{ q: "vídeo", channelId: CHANNEL_ID }]);
    await app.close();
  });

  it("passa tipo e sort para o cliente de Busca", async () => {
    const ledger = new PostgresLedger(pool);
    await ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
    const search = makeSearchClient();
    const app = buildApp(makeConfig(), { ledger, queue: makeStubQueue(), youtube: makeYouTubeClient(), search });

    const res = await app.inject({
      method: "GET",
      url: `/search?q=x&channelId=${CHANNEL_ID}&tipo=video&sort=publishedAt`,
    });

    expect(res.statusCode).toBe(200);
    expect(search.calls).toEqual([{ q: "x", channelId: CHANNEL_ID, tipo: "video", sort: "publishedAt" }]);
    await app.close();
  });

  it("retorna Comentários com destaque quando tipo=comment", async () => {
    const ledger = new PostgresLedger(pool);
    await ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
    const commentResults: SearchResponse = {
      hits: [
        {
          id: "c1",
          channelId: CHANNEL_ID,
          type: "comment",
          videoId: "v1",
          videoTitle: "Primeiro vídeo",
          videoUrl: "https://www.youtube.com/watch?v=v1",
          videoThumbnail: "https://i.ytimg.com/vi/v1/hqdefault.jpg",
          videoViews: 100,
          videoLikes: 10,
          url: "https://www.youtube.com/watch?v=v1&lc=c1",
          author: "Gato Funky",
          text: "Primeiro comentário",
          likes: 5,
          publishedAt: "2023-01-01T00:00:00Z",
          _formatted: { text: "Primeiro <em>comentário</em>" },
        },
      ],
      total: 1,
      query: "comentário",
    };
    const search = makeSearchClient(commentResults);
    const app = buildApp(makeConfig(), { ledger, queue: makeStubQueue(), youtube: makeYouTubeClient(), search });

    const res = await app.inject({
      method: "GET",
      url: `/search?q=comentário&channelId=${CHANNEL_ID}&tipo=comment`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(commentResults);
    expect(search.calls).toEqual([{ q: "comentário", channelId: CHANNEL_ID, tipo: "comment" }]);
    await app.close();
  });

  it("responde 400 quando q é obrigatório", async () => {
    const app = buildApp(makeConfig(), {
      ledger: new PostgresLedger(pool),
      queue: makeStubQueue(),
      youtube: makeYouTubeClient(),
      search: makeSearchClient(),
    });

    const res = await app.inject({ method: "GET", url: "/search" });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("responde 400 quando channelId é obrigatório", async () => {
    const app = buildApp(makeConfig(), {
      ledger: new PostgresLedger(pool),
      queue: makeStubQueue(),
      youtube: makeYouTubeClient(),
      search: makeSearchClient(),
    });

    const res = await app.inject({ method: "GET", url: "/search?q=x" });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("responde 404 para um channelId desconhecido", async () => {
    const app = buildApp(makeConfig(), {
      ledger: new PostgresLedger(pool),
      queue: makeStubQueue(),
      youtube: makeYouTubeClient(),
      search: makeSearchClient(),
    });

    const res = await app.inject({ method: "GET", url: "/search?q=x&channelId=desconhecido" });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("responde 400 para tipo inválido", async () => {
    const app = buildApp(makeConfig(), {
      ledger: new PostgresLedger(pool),
      queue: makeStubQueue(),
      youtube: makeYouTubeClient(),
      search: makeSearchClient(),
    });

    const res = await app.inject({ method: "GET", url: `/search?q=x&channelId=${CHANNEL_ID}&tipo=reply` });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("responde 400 para sort inválido", async () => {
    const app = buildApp(makeConfig(), {
      ledger: new PostgresLedger(pool),
      queue: makeStubQueue(),
      youtube: makeYouTubeClient(),
      search: makeSearchClient(),
    });

    const res = await app.inject({ method: "GET", url: `/search?q=x&channelId=${CHANNEL_ID}&sort=likes` });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("com um registry fake de um doc type, valida tipo apenas contra esse type", async () => {
    const ledger = new PostgresLedger(pool);
    await ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
    const search = makeSearchClient();
    const fakePhases: readonly PhaseMeta[] = [
      { key: "videos", label: "Vídeos", doc: "video", describe: () => "" },
    ];
    const app = buildApp(makeConfig(), { ledger, queue: makeStubQueue(), youtube: makeYouTubeClient(), search }, fakePhases);

    // tipo=video existe no registry fake → 200
    const ok = await app.inject({
      method: "GET",
      url: `/search?q=x&channelId=${CHANNEL_ID}&tipo=video`,
    });
    expect(ok.statusCode).toBe(200);

    // tipo=comment não existe no registry fake → 400
    const bad = await app.inject({
      method: "GET",
      url: `/search?q=x&channelId=${CHANNEL_ID}&tipo=comment`,
    });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
});