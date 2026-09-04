import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  PostgresIngestionQueue,
  PostgresLedger,
  SqliteIngestionQueue,
  SqliteLedger,
  applyPgSchema,
  closePgPool,
  createDatabase,
  createIngestion,
  createPgPool,
  type Ingestion,
  type IngestionQueue,
  type Ledger,
  type Pool,
  type Projection,
  type TranscriptFetcher,
  type YouTubeClient,
} from "@youtube-index/domain";
import { pollOnce } from "../src/worker.js";

/**
 * `WorkerDeps` é a borda testada: `{ queue, ingestion }`. A interface
 * `IngestionQueue` é a mesma para ambos os backends (`SqliteIngestionQueue`
 * e `PostgresIngestionQueue`), então o `pollOnce` exercita o caminho
 * Postgres end-to-end quando recebe um `PostgresIngestionQueue`. Cada
 * backend monta seu próprio `setup()` que devolve `{ ledger, queue,
 * channelId }`; o teste então cria o Canal, enfileira um job e dirige
 * o `pollOnce` como se fosse um tick do Worker.
 *
 * O Postgres precisa de um pool compartilhado + `applyPgSchema` (uma vez,
 * via `beforeAll`) e de cleanup por teste (`afterEach` deleta os canais
 * via cascade, que varre `ingestion_jobs` junto). O SQLite usa `:memory:`
 * por teste, sem cleanup.
 */

interface WorkerHandle {
  ledger: Ledger;
  queue: IngestionQueue;
  channelId: string;
}

interface WorkerBackend {
  name: string;
  setup(): Promise<WorkerHandle>;
}

const CHANNEL_ID = "UCY8iijN1AkyDCh1Z9akcqUA";

function makeYouTube(channelId: string): YouTubeClient {
  return {
    resolveHandle: async () => ({ channelId, title: "Funky Black Cat" }),
    getUploadsPlaylistId: async () => `UUPL-${channelId}`,
    listUploads: async () => ({
      videos: [
        { id: "v1", title: "Primeiro vídeo", description: "desc", publishedAt: "2023-01-01T00:00:00Z" },
        { id: "v2", title: "Segundo vídeo", description: "desc", publishedAt: "2023-01-02T00:00:00Z" },
      ],
      nextPageToken: null,
    }),
    getVideoStats: async (videoId) =>
      videoId === "v1" ? { views: 100, likes: 10, durationSeconds: 120 } : { views: 200, likes: 20, durationSeconds: 240 },
    listComments: async () => [],
  };
}

const transcripts: TranscriptFetcher = { fetchTranscript: async () => ({ kind: "absent" }) };
const projection: Projection = {
  addDocuments: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

const sqliteBackend: WorkerBackend = {
  name: "Sqlite",
  async setup() {
    const db = createDatabase(":memory:");
    return {
      ledger: new SqliteLedger(db),
      queue: new SqliteIngestionQueue(db),
      channelId: CHANNEL_ID,
    };
  },
};

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/youtube_index";
let pgPool: Pool;
const pgCreatedChannelIds: string[] = [];
let pgCounter = 0;

const postgresBackend: WorkerBackend = {
  name: "Postgres",
  async setup() {
    const channelId = `UC_W44_${process.pid}_${++pgCounter}`;
    pgCreatedChannelIds.push(channelId);
    return {
      ledger: new PostgresLedger(pgPool),
      queue: new PostgresIngestionQueue(pgPool),
      channelId,
    };
  },
};

const backends: WorkerBackend[] = [sqliteBackend, postgresBackend];

beforeAll(async () => {
  pgPool = createPgPool({ databaseUrl: DATABASE_URL });
  await applyPgSchema(pgPool);
});

afterAll(async () => {
  await closePgPool(pgPool);
});

// O backend Postgres compartilha um único banco entre todos os testes;
// sem cleanup, jobs órfãos de testes anteriores ficam na fila e o
// `claimNext` FIFO os pega antes do job do teste atual. O cascade do
// `DELETE FROM channels` varre `ingestion_jobs` junto.
afterEach(async () => {
  if (pgCreatedChannelIds.length > 0) {
    await pgPool.query("DELETE FROM channels WHERE id = ANY($1)", [pgCreatedChannelIds]);
    pgCreatedChannelIds.length = 0;
  }
});

describe.each(backends)("pollOnce com $name", ({ setup }) => {
  it("consome o job da Fila de Ingestão, executa a Ingestão e completa o job", async () => {
    const { ledger, queue, channelId } = await setup();
    await ledger.createChannel({ channelId, handle: "@funkyblackcat", title: "Funky Black Cat" });
    const job = await queue.enqueue(channelId);

    const ingestion: Ingestion = createIngestion({
      youtube: makeYouTube(channelId),
      transcripts,
      ledger,
      projection,
    });

    const processed = await pollOnce({ queue, ingestion });

    expect(processed).toBe(true);
    expect(await queue.listJobs(channelId)).toEqual([
      expect.objectContaining({ id: job.id, status: "completed" }),
    ]);
    expect(await ledger.getChannel(channelId)).toMatchObject({
      status: "completed",
      phases: { videos: { status: "completed", done: 2, total: 2 } },
    });
    expect(await ledger.listVideos(channelId)).toHaveLength(2);
  });

  it("marca o job como failed e relança o erro quando a Ingestão falha", async () => {
    const { ledger, queue, channelId } = await setup();
    await ledger.createChannel({ channelId, handle: "@funkyblackcat", title: "Funky Black Cat" });
    const job = await queue.enqueue(channelId);

    const failingIngestion: Ingestion = {
      runJob: async () => {
        throw new Error("cota esgotada");
      },
    };

    await expect(pollOnce({ queue, ingestion: failingIngestion })).rejects.toThrow("cota esgotada");

    expect(await queue.listJobs(channelId)).toEqual([
      expect.objectContaining({ id: job.id, status: "failed" }),
    ]);
  });

  it("retorna false quando não há job na Fila de Ingestão", async () => {
    const { ledger, queue, channelId } = await setup();
    const ingestion: Ingestion = createIngestion({
      youtube: makeYouTube(channelId),
      transcripts,
      ledger,
      projection,
    });

    const processed = await pollOnce({ queue, ingestion });

    expect(processed).toBe(false);
  });
});