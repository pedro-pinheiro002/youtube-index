import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase, createServices } from "@youtube-index/domain";

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
  });
  const app = buildApp(config, services);

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
