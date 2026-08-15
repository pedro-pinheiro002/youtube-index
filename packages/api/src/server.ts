import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase, SqliteLedger, YouTubeDataApiClient } from "@youtube-index/domain";

async function main(): Promise<void> {
  const config = loadConfig();

  const db = createDatabase(config.dbPath);
  const ledger = new SqliteLedger(db);
  const youtube = new YouTubeDataApiClient(config.youtubeApiKey);
  const app = buildApp(config, { ledger, youtube });

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();