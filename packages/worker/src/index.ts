import { loadConfig } from "./config.js";
import { createHealthServer } from "./health.js";
import { pollOnce } from "./worker.js";
import { createDatabase, createServices, type IngestionLogger } from "@youtube-index/domain";

const logger: IngestionLogger = {
  info: (message) => console.log(`[worker] ${message}`),
  warn: (message) => console.warn(`[worker] ${message}`),
  error: (message, cause) => console.error(`[worker] ${message}`, cause),
  event: (event, data) => console.log(`[worker] ${event}: ${JSON.stringify(data)}`),
};

async function main(): Promise<void> {
  const config = loadConfig();

  const db = createDatabase(config.dbPath);
  const services = await createServices({
    db,
    config: {
      youtubeApiKey: config.youtubeApiKey,
      meilisearchUrl: config.meiliUrl,
      meilisearchMasterKey: config.meiliMasterKey,
    },
    logger,
  });

  const healthServer = createHealthServer();
  await new Promise<void>((resolve) => healthServer.listen(config.healthPort, resolve));

  console.log(`[worker] iniciado. health em http://localhost:${config.healthPort}/health`);

  const tick = async () => {
    try {
      const processed = await pollOnce({ queue: services.queue, ingestion: services.ingestion });
      if (processed) {
        logger.info("job processado com sucesso");
      }
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err), err instanceof Error ? err : undefined);
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