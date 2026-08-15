export interface WorkerConfig {
  healthPort: number;
  dbPath: string;
  youtubeApiKey: string;
  pollIntervalMs: number;
  meiliUrl: string;
  meiliMasterKey: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    healthPort: Number(env.WORKER_HEALTH_PORT ?? 8081),
    dbPath: env.DB_PATH ?? "data/youtube-index.db",
    youtubeApiKey: env.YOUTUBE_API_KEY ?? "",
    pollIntervalMs: Number(env.WORKER_POLL_INTERVAL_MS ?? 5000),
    meiliUrl: env.MEILI_URL ?? "http://localhost:7700",
    meiliMasterKey: env.MEILI_MASTER_KEY ?? "",
  };
}