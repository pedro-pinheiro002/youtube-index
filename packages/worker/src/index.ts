import { loadConfig } from "./config.js";
import { createHealthServer } from "./health.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const healthServer = createHealthServer();
  await new Promise<void>((resolve) => healthServer.listen(config.healthPort, resolve));

  console.log(`[worker] iniciado. health em http://localhost:${config.healthPort}/health`);

  const stop = () => {
    console.log("[worker] encerrando.");
    healthServer.close(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error("[worker] erro fatal:", err);
  process.exit(1);
});