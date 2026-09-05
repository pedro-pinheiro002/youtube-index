import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import {
  createPgPool,
  createServices,
  closePgPool,
  runNextJob,
  JobListener,
  type Pool,
} from "@youtube-index/domain";

async function main(): Promise<void> {
  const config = loadConfig();

  if (!config.databaseUrl) {
    console.error("DATABASE_URL é obrigatório (slice #47/#48).");
    process.exit(1);
  }

  const pool = createPgPool({ databaseUrl: config.databaseUrl });
  const services = await createServices({
    pool,
    config: {
      youtubeApiKey: config.youtubeApiKey,
    },
  });
  const app = buildApp(config, services);

  // Concurrency guard: o `setInterval` e o `LISTEN ingestion_jobs`
  // podem disparar `runNextJob` ao mesmo tempo. O flag evita que dois
  // ticks disputem o `claimNext` simultaneamente.
  let tickInFlight = false;
  const tick = async (): Promise<void> => {
    if (tickInFlight) return;
    tickInFlight = true;
    try {
      // `runNextJob` retorna false quando a fila está vazia; não
      // precisamos parar — o próximo tick ou NOTIFY tenta de novo.
      await runNextJob({ queue: services.queue, ingestion: services.ingestion });
    } catch (err) {
      app.log.error({ err }, "runNextJob falhou");
    } finally {
      tickInFlight = false;
    }
  };

  const interval = setInterval(() => {
    void tick();
  }, config.pollIntervalMs);

  const listener = new JobListener(pool, {
    onNotify: () => tick(),
    logger: { info: (msg) => app.log.info(msg), error: (msg, cause) => app.log.error({ cause }, msg) },
  });
  await listener.start();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} recebido, encerrando...`);
    clearInterval(interval);
    await listener.stop();
    await app.close();
    await closePgPool(pool);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
