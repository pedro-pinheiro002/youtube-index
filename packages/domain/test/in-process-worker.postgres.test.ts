import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyPgSchema,
  closePgPool,
  createIngestion,
  createPgPool,
  JobListener,
  PostgresIngestionQueue,
  PostgresLedger,
  runNextJob,
  type Ingestion,
  type Pool,
} from "@youtube-index/domain";
import { YoutubeTranscriptFetcher } from "../src/transcripts.js";

/**
 * Teste de integração do loop em-processo (#47). Sem nenhum Worker
 * rodando, enfileiramos um Job no Postgres e verificamos que o
 * `JobListener` recebe o `NOTIFY` e executa `runNextJob` dentro do
 * orçamento de `POLL_INTERVAL_MS + slack` (a meta aqui é bem mais
 * apertada — queremos ver o wake por NOTIFY, não o tick do
 * setInterval).
 *
 * Pré-requisito: Postgres acessível em DATABASE_URL.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/youtube_index";

const CHANNEL_ID = "UC_INPROCESS_47";

describe("POSTGRES in-process worker (slice #47)", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createPgPool({ databaseUrl: DATABASE_URL });
    await applyPgSchema(pool);
    await pool.query("DELETE FROM channels WHERE id = $1", [CHANNEL_ID]);
  });

  afterAll(async () => {
    await pool.query("DELETE FROM channels WHERE id = $1", [CHANNEL_ID]);
    await closePgPool(pool);
  });

  it("wake do NOTIFY dispara runNextJob em menos de POLL_INTERVAL_MS", async () => {
    const ledger = new PostgresLedger(pool);
    const queue = new PostgresIngestionQueue(pool);
    const ingestion: Ingestion = createIngestion({
      youtube: {
        resolveHandle: async () => ({ channelId: CHANNEL_ID, title: "Canal In-Process" }),
        getUploadsPlaylistId: async () => "PL_INPROCESS",
        listUploads: async () => ({ videos: [], nextPageToken: null }),
        getVideoStats: async () => null,
        listComments: async () => [],
      },
      transcripts: new YoutubeTranscriptFetcher(),
      ledger,
    });

    let ticks = 0;
    const start = Date.now();
    const listener = new JobListener(pool, {
      onNotify: () => {
        ticks += 1;
        return runNextJob({ queue, ingestion }).catch(() => undefined);
      },
      logger: { info: () => {}, error: () => {} },
    });
    await listener.start();

    try {
      await ledger.createChannel({ channelId: CHANNEL_ID, handle: "@in-process", title: "Canal In-Process" });
      await queue.enqueue(CHANNEL_ID);

      // Espera o job ser processado. O orçamento total cobre tanto o
      // wake por NOTIFY quanto o tempo de execução da Ingestão (sem
      // rede porque o YouTubeClient é fake); queremos detectar
      // regressões onde o wake por NOTIFY deixa de funcionar e a api
      // fica dependente do tick do setInterval.
      const deadline = Date.now() + 5000;
      let completed = false;
      while (Date.now() < deadline) {
        const jobs = await queue.listJobs(CHANNEL_ID);
        if (jobs[0]?.status === "completed") {
          completed = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      const elapsed = Date.now() - start;
      expect(ticks).toBeGreaterThan(0);
      expect(completed).toBe(true);
      // 5s de orçamento: cobre caminho NOTIFY (ms) + Ingestão sem rede
      // (~50ms). Se passar disso, o wake por NOTIFY está quebrado.
      expect(elapsed).toBeLessThan(5000);
    } finally {
      await listener.stop();
    }
  });
});
