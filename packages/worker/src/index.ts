import { loadConfig } from "./config.js";
import { createHealthServer } from "./health.js";
import { pollOnce } from "./worker.js";
import {
  createDatabase,
  createIngestion,
  MeilisearchProjection,
  SqliteLedger,
  YouTubeDataApiClient,
  YoutubeTranscriptFetcher,
} from "@youtube-index/domain";

async function main(): Promise<void> {
  const config = loadConfig();

  const db = createDatabase(config.dbPath);
  const ledger = new SqliteLedger(db);
  const youtube = new YouTubeDataApiClient(config.youtubeApiKey);

  const transcripts = new YoutubeTranscriptFetcher();
  const projection = new MeilisearchProjection({ url: config.meiliUrl, masterKey: config.meiliMasterKey });
  const ingestion = createIngestion({ youtube, transcripts, ledger, projection });

  const healthServer = createHealthServer();
  await new Promise<void>((resolve) => healthServer.listen(config.healthPort, resolve));

  console.log(`[worker] iniciado. health em http://localhost:${config.healthPort}/health`);

  const tick = async () => {
    try {
      await pollOnce({ ledger, ingestion });
    } catch (err) {
      console.error("[worker] erro ao processar job:", err);
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