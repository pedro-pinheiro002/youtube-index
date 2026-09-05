export interface AppConfig {
  host: string;
  port: number;
  databaseUrl: string;
  pollIntervalMs: number;
  webDistDir: string | null;
  youtubeApiKey: string;
  logger: boolean;
}

const DEFAULT_POLL_INTERVAL_MS = 1000;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST ?? "0.0.0.0",
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL ?? "",
    pollIntervalMs: Number(env.POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS),
    webDistDir: env.WEB_DIST_DIR ?? null,
    youtubeApiKey: env.YOUTUBE_API_KEY ?? "",
    logger: env.NODE_ENV !== "test",
  };
}
