export interface AppConfig {
  host: string;
  port: number;
  meiliUrl: string;
  meiliMasterKey: string;
  webDistDir: string | null;
  dbPath: string;
  youtubeApiKey: string;
  logger: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST ?? "0.0.0.0",
    port: Number(env.PORT ?? 3000),
    meiliUrl: env.MEILI_URL ?? "http://localhost:7700",
    meiliMasterKey: env.MEILI_MASTER_KEY ?? "",
    webDistDir: env.WEB_DIST_DIR ?? null,
    dbPath: env.DB_PATH ?? "data/youtube-index.db",
    youtubeApiKey: env.YOUTUBE_API_KEY ?? "",
    logger: env.NODE_ENV !== "test",
  };
}