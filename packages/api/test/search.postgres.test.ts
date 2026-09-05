import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  applyPgSchema,
  closePgPool,
  createPgPool,
  PostgresLedger,
  PostgresSearchProjection,
  type CommentRecord,
  type IngestionQueue,
  type Job,
  type Pool,
  type TranscriptSegmentRecord,
  type VideoRecord,
  type YouTubeClient,
} from "@youtube-index/domain";
import { makeConfig } from "./helpers.js";

/**
 * Teste de integração que valida o slice #45: o endpoint `GET /search`
 * passa a ler do Postgres (via PostgresSearchProjection) em vez de
 * chamar o Meilisearch. Os Documentos são materializados pelo
 * PostgresLedger (colunas `fts` geradas), e o teste semeia o Canal e
 * verifica o destaque `ts_headline` e os filtros `tipo`/`channelId` no
 * resposta HTTP.
 *
 * Pré-requisito: Postgres acessível em DATABASE_URL (padrão
 * `postgres://postgres:postgres@localhost:5432/youtube_index`).
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/youtube_index";

const CHANNEL_ID = "UC_SEARCH_API_45";

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

function makeStubYouTube(): YouTubeClient {
  return {
    resolveHandle: async () => ({ channelId: CHANNEL_ID, title: "Canal Slice 45" }),
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
}

describe("POSTGRES GET /search (slice #45)", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createPgPool({ databaseUrl: DATABASE_URL });
    await applyPgSchema(pool);
    // Limpa qualquer resíduo do Canal sob teste.
    await pool.query("DELETE FROM channels WHERE id = $1", [CHANNEL_ID]);

    const ledger = new PostgresLedger(pool);
    await ledger.createChannel({
      channelId: CHANNEL_ID,
      handle: "@postgres-search-slice",
      title: "Canal Postgres Search Slice",
    });
    const videoA: VideoRecord = {
      id: "vs_api_45_a",
      channelId: CHANNEL_ID,
      title: "Como treinar um gato preto comportamento",
      description: "dicas de comportamento felino",
      publishedAt: "2023-01-01T00:00:00Z",
      views: 100,
      likes: 10,
      durationSeconds: 120,
    };
    const videoB: VideoRecord = {
      id: "vs_api_45_b",
      channelId: CHANNEL_ID,
      title: "Receita de strogonoff",
      description: "ingredientes e modo de preparo",
      publishedAt: "2023-01-02T00:00:00Z",
      views: 200,
      likes: 20,
      durationSeconds: 240,
    };
    await ledger.upsertVideo(videoA);
    await ledger.upsertVideo(videoB);
    const commentA: CommentRecord = {
      id: "cs_api_45_a",
      videoId: videoA.id,
      channelId: CHANNEL_ID,
      author: "Gato Funky",
      text: "Adorei as dicas de comportamento",
      likes: 5,
      publishedAt: "2023-01-01T00:00:00Z",
    };
    await ledger.upsertComment(commentA);
    const segmentA: TranscriptSegmentRecord = {
      id: "ss_api_45_a",
      videoId: videoA.id,
      channelId: CHANNEL_ID,
      start: 0,
      end: 5,
      text: "Hoje vamos falar sobre gatos pretos",
    };
    await ledger.upsertTranscriptSegment(segmentA);
  });

  afterAll(async () => {
    await pool.query("DELETE FROM channels WHERE id = $1", [CHANNEL_ID]);
    await closePgPool(pool);
  });

  it("devolve Vídeos com destaque (ts_headline) lendo do Postgres", async () => {
    const search = new PostgresSearchProjection(pool);
    const app = buildApp(makeConfig(), {
      ledger: new PostgresLedger(pool),
      queue: makeStubQueue(),
      youtube: makeStubYouTube(),
      search,
    });

    const res = await app.inject({
      method: "GET",
      url: `/search?q=comportamento&channelId=${CHANNEL_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.query).toBe("comportamento");
    expect(body.hits.length).toBeGreaterThanOrEqual(1);
    const gatoHit = body.hits.find(
      (h: { id: string }) => h.id === "vs_api_45_a",
    );
    expect(gatoHit).toBeDefined();
    expect(gatoHit.type).toBe("video");
    expect(gatoHit._formatted.title).toContain("<em>");
    expect(gatoHit._formatted.description).toContain("<em>");
  });

  it("devolve Comentários quando tipo=comment", async () => {
    const search = new PostgresSearchProjection(pool);
    const app = buildApp(makeConfig(), {
      ledger: new PostgresLedger(pool),
      queue: makeStubQueue(),
      youtube: makeStubYouTube(),
      search,
    });

    const res = await app.inject({
      method: "GET",
      url: `/search?q=comportamento&channelId=${CHANNEL_ID}&tipo=comment`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hits).toHaveLength(1);
    expect(body.hits[0]).toMatchObject({
      id: "cs_api_45_a",
      type: "comment",
      videoId: "vs_api_45_a",
      author: "Gato Funky",
    });
    expect(body.hits[0]._formatted.text).toContain("<em>");
  });
});
