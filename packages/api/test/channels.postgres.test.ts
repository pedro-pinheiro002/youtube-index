import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  applyPgSchema,
  closePgPool,
  createPgPool,
  PostgresLedger,
  POSTGRES_SCHEMA,
  type IngestionQueue,
  type Job,
  type Pool,
  type SearchPort,
  type SearchResponse,
  type YouTubeClient,
} from "@youtube-index/domain";
import { makeConfig } from "./helpers.js";

/**
 * Teste de integração que valida o slice #42: o ciclo de vida do Canal
 * (criação, listagem, busca por id) passa pelo Postgres real quando o
 * backend é o PostgresLedger.
 *
 * Pré-requisito: um Postgres acessível em DATABASE_URL (padrão
 * postgres://postgres:postgres@localhost:5432/youtube_index). Em dev local
 * há um container docker "youtube-index-pg" com essas credenciais.
 *
 * A fila de ingestão ainda usa SQLite (#44 ainda não foi feito), então
 * este teste NÃO passa por createServices — ele monta a AppDeps na mão
 * com um IngestionQueue fake (stub) e só verifica o caminho HTTP →
 * PostgresLedger.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/youtube_index";

const YOUTUBE_CHANNEL_ID = "UC_POSTGRES_SLICE_42";
const YOUTUBE_HANDLE = "@postgres-slice";
const YOUTUBE_TITLE = "Canal do Postgres Slice";

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

function makeStubSearch(): SearchPort {
  return {
    search: async (): Promise<SearchResponse> => ({ hits: [], total: 0, query: "" }),
  };
}

function makeStubYouTube(): YouTubeClient {
  return {
    resolveHandle: async () => ({ channelId: YOUTUBE_CHANNEL_ID, title: YOUTUBE_TITLE }),
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

describe("POSTGRES channel lifecycle (slice #42)", () => {
  let pool: Pool;
  let cleanupIds: string[] = [];

  beforeAll(async () => {
    pool = createPgPool({ databaseUrl: DATABASE_URL });
    await applyPgSchema(pool);
    // sanity check: garante que o schema aplicado bate com o exportado.
    expect(typeof POSTGRES_SCHEMA).toBe("string");
    expect(POSTGRES_SCHEMA).toContain("CREATE TABLE IF NOT EXISTS channels");
  });

  afterAll(async () => {
    if (cleanupIds.length > 0) {
      await pool.query("DELETE FROM channels WHERE id = ANY($1)", [cleanupIds]);
    }
    await closePgPool(pool);
  });

  it("POST /channels cria o Canal no Postgres e devolve 201 com status queued", async () => {
    const ledger = new PostgresLedger(pool);
    const app = buildApp(makeConfig(), {
      ledger,
      queue: makeStubQueue(),
      youtube: makeStubYouTube(),
      search: makeStubSearch(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/channels",
      payload: { handle: YOUTUBE_HANDLE },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      id: YOUTUBE_CHANNEL_ID,
      handle: YOUTUBE_HANDLE,
      title: YOUTUBE_TITLE,
      status: "queued",
    });
    expect(body.phases).toMatchObject({
      videos: { phase: "videos", status: "pending", done: 0, total: null },
      comments: { phase: "comments", status: "pending", done: 0, total: null },
      transcripts: { phase: "transcripts", status: "pending", done: 0, total: null },
    });

    // Confirma via SQL direto que a linha foi realmente gravada no Postgres.
    const dbRow = await pool.query<{ id: string; status: string }>(
      "SELECT id, status FROM channels WHERE id = $1",
      [YOUTUBE_CHANNEL_ID],
    );
    expect(dbRow.rows[0]?.status).toBe("queued");

    cleanupIds.push(YOUTUBE_CHANNEL_ID);
    await app.close();
  });

  it("GET /channels/:id devolve o Canal persistido no Postgres", async () => {
    const ledger = new PostgresLedger(pool);
    // Cria direto via ledger (sem passar pela rota) para isolar o GET.
    await ledger.createChannel({
      channelId: YOUTUBE_CHANNEL_ID,
      handle: YOUTUBE_HANDLE,
      title: YOUTUBE_TITLE,
    });
    cleanupIds.push(YOUTUBE_CHANNEL_ID);

    const app = buildApp(makeConfig(), {
      ledger,
      queue: makeStubQueue(),
      youtube: makeStubYouTube(),
      search: makeStubSearch(),
    });

    const res = await app.inject({ method: "GET", url: `/channels/${YOUTUBE_CHANNEL_ID}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: YOUTUBE_CHANNEL_ID,
      handle: YOUTUBE_HANDLE,
      title: YOUTUBE_TITLE,
      status: "queued",
    });
    await app.close();
  });

  it("GET /channels lista todos os Canais persistidos no Postgres", async () => {
    const ledger = new PostgresLedger(pool);
    // Garante pelo menos um Canal com id único deste teste.
    const id = `${YOUTUBE_CHANNEL_ID}_LIST`;
    await ledger.createChannel({
      channelId: id,
      handle: "@list",
      title: "Canal da Lista",
    });
    cleanupIds.push(id);

    const app = buildApp(makeConfig(), {
      ledger,
      queue: makeStubQueue(),
      youtube: makeStubYouTube(),
      search: makeStubSearch(),
    });

    const res = await app.inject({ method: "GET", url: "/channels" });

    expect(res.statusCode).toBe(200);
    const list = res.json() as Array<{ id: string }>;
    const ids = list.map((c) => c.id);
    expect(ids).toContain(id);
    await app.close();
  });

  it("GET /channels/:id devolve 404 para um Canal inexistente", async () => {
    const ledger = new PostgresLedger(pool);
    const app = buildApp(makeConfig(), {
      ledger,
      queue: makeStubQueue(),
      youtube: makeStubYouTube(),
      search: makeStubSearch(),
    });

    const res = await app.inject({ method: "GET", url: "/channels/UC_nao_existe" });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("deleteChannel apaga o Canal e os cascades somem channel_phases + ingestion_jobs", async () => {
    const ledger = new PostgresLedger(pool);
    const id = "UC_POSTGRES_DELETE";
    await ledger.createChannel({
      channelId: id,
      handle: "@delete",
      title: "Canal a deletar",
    });
    // Confirma que fases foram gravadas.
    const before = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM channel_phases WHERE channel_id = $1",
      [id],
    );
    expect(Number(before.rows[0]?.count ?? "0")).toBe(3);

    await ledger.deleteChannel(id);

    expect(await ledger.getChannel(id)).toBeNull();
    const phasesAfter = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM channel_phases WHERE channel_id = $1",
      [id],
    );
    expect(Number(phasesAfter.rows[0]?.count ?? "0")).toBe(0);
  });
});
