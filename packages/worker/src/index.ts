import { loadConfig } from "./config.js";
import { createHealthServer } from "./health.js";
import { pollOnce } from "./worker.js";
import {
  createDatabase,
  createIngestion,
  createMeilisearchProjection,
  SqliteIngestionQueue,
  SqliteLedger,
  YouTubeDataApiClient,
  YoutubeTranscriptFetcher,
  type IngestionLogger,
} from "@youtube-index/domain";

const logger: IngestionLogger = {
  info: (message) => console.log(`[worker] ${message}`),
  warn: (message) => console.warn(`[worker] ${message}`),
  error: (message) => console.error(`[worker] ${message}`),
};

async function main(): Promise<void> {
  const config = loadConfig();

  const db = createDatabase(config.dbPath);
  const ledger = new SqliteLedger(db);
  const fila = new SqliteIngestionQueue(db);
  const youtube = new YouTubeDataApiClient(config.youtubeApiKey);

  const transcripts = new YoutubeTranscriptFetcher();
  const projection = await createMeilisearchProjection({
    url: config.meiliUrl,
    masterKey: config.meiliMasterKey,
  });
  const ingestion = createIngestion({ youtube, transcripts, ledger, projection, logger });

  const healthServer = createHealthServer();
  await new Promise<void>((resolve) => healthServer.listen(config.healthPort, resolve));

  console.log(`[worker] iniciado. health em http://localhost:${config.healthPort}/health`);

  const tick = async () => {
    try {
      const processed = await pollOnce({ fila, ingestion });
      if (processed) {
        logger.info("job processado com sucesso");
      }
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
    }
  };
  const timer = setInterval(tick, config.pollIntervalMs);

  const stop = () => {
    console.log("[worker] encerrando.");
    clearInterval(timer);
    healthServer.close(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error("[worker] erro fatal:", err);
  process.exit(1);
});