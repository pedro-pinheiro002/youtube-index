export interface AppConfig {
  host: string;
  port: number;
  meiliUrl: string;
  meiliMasterKey: string;
  webDistDir: string | null;
  logger: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST ?? "0.0.0.0",
    port: Number(env.PORT ?? 3000),
    meiliUrl: env.MEILI_URL ?? "http://localhost:7700",
    meiliMasterKey: env.MEILI_MASTER_KEY ?? "",
    webDistDir: env.WEB_DIST_DIR ?? null,
    logger: env.NODE_ENV !== "test",
  };
}