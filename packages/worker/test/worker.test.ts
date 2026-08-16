import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import {
  createDatabase,
  createIngestion,
  SqliteIngestionQueue,
  SqliteLedger,
  type Ingestion,
  type IngestionQueue,
  type Ledger,
  type Projection,
  type TranscriptFetcher,
  type YouTubeClient,
} from "@youtube-index/domain";
import { pollOnce } from "../src/worker.js";

const CHANNEL_ID = "UCY8iijN1AkyDCh1Z9akcqUA";

function makeDatabase(): DatabaseSync {
  return createDatabase(":memory:");
}

function makeLedger(db: DatabaseSync): Ledger {
  return new SqliteLedger(db);
}

function makeQueue(db: DatabaseSync): IngestionQueue {
  return new SqliteIngestionQueue(db);
}

function makeIngestion(ledger: Ledger): Ingestion {
  const youtube: YouTubeClient = {
    resolveHandle: async () => ({ channelId: CHANNEL_ID, title: "Funky Black Cat" }),
    getUploadsPlaylistId: async () => "UUPL-funky",
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
  const transcripts: TranscriptFetcher = { fetchTranscript: async () => null };
  const projection: Projection = {
    addDocuments: async () => {},
    remove: async () => {},
    clear: async () => {},
  };
  return createIngestion({ youtube, transcripts, ledger, projection });
}

function makeChannel(ledger: Ledger): void {
  ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
}

describe("pollOnce", () => {
  it("consome o job da Fila, executa a Fase de Vídeos e completa o job", async () => {
    const db = makeDatabase();
    const ledger = makeLedger(db);
    const fila = makeQueue(db);
    makeChannel(ledger);
    const job = fila.enqueue(CHANNEL_ID);
    const ingestion = makeIngestion(ledger);

    const processed = await pollOnce({ fila, ingestion });

    expect(processed).toBe(true);
    expect(fila.listJobs(CHANNEL_ID)).toEqual([
      expect.objectContaining({ id: job.id, status: "completed" }),
    ]);
    expect(ledger.getChannel(CHANNEL_ID)).toMatchObject({
      status: "completed",
      phases: { videos: { status: "completed", done: 2, total: 2 } },
    });
    expect(ledger.listVideos(CHANNEL_ID)).toHaveLength(2);
  });

  it("marca o job como failed e relança o erro quando a Ingestão falha", async () => {
    const db = makeDatabase();
    const ledger = makeLedger(db);
    const fila = makeQueue(db);
    makeChannel(ledger);
    const job = fila.enqueue(CHANNEL_ID);
    const failingIngestion: Ingestion = {
      runJob: async () => {
        throw new Error("cota esgotada");
      },
      _runPhase: async () => {},
      runVideosPhase: async () => {},
      runCommentsPhase: async () => {},
      runTranscriptsPhase: async () => {},
    };

    await expect(pollOnce({ fila, ingestion: failingIngestion })).rejects.toThrow("cota esgotada");

    expect(fila.listJobs(CHANNEL_ID)).toEqual([
      expect.objectContaining({ id: job.id, status: "failed" }),
    ]);
  });

  it("retorna false quando não há job na Fila", async () => {
    const db = makeDatabase();
    const ledger = makeLedger(db);
    const fila = makeQueue(db);

    const processed = await pollOnce({ fila, ingestion: makeIngestion(ledger) });

    expect(processed).toBe(false);
  });
});
