export interface WorkerConfig {
  healthPort: number;
  meiliUrl: string;
  meiliMasterKey: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    healthPort: Number(env.WORKER_HEALTH_PORT ?? 8081),
    meiliUrl: env.MEILI_URL ?? "http://localhost:7700",
    meiliMasterKey: env.MEILI_MASTER_KEY ?? "",
  };
}