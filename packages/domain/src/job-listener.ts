import type pg from "pg";

/**
 * Conecta a um `pg.Pool` numa conexão dedicada e escuta o canal
 * `ingestion_jobs`. Quando recebe um `NOTIFY`, executa o `onNotify`
 * (geralmente um `runNextJob`). O `JobListener` mantém um flag
 * `running` para que chamadas concorrentes de `runNextJob` não se
 * sobreponham — o loop `setInterval` e o subscriber podem disparar
 * ao mesmo tempo.
 *
 * O método `stop()` remove o listener, libera o cliente e ignora
 * futuras notificações. Deve ser chamado no shutdown.
 */
export class JobListener {
  private readonly pool: pg.Pool;
  private readonly channel: string;
  private readonly onNotify: () => Promise<void> | void;
  private readonly logger: { info: (msg: string) => void; error: (msg: string, cause?: unknown) => void };
  private client: pg.PoolClient | null = null;
  private running = false;
  private stopped = false;

  constructor(
    pool: pg.Pool,
    options: {
      channel?: string;
      onNotify: () => Promise<void> | void;
      logger?: { info: (msg: string) => void; error: (msg: string, cause?: unknown) => void };
    },
  ) {
    this.pool = pool;
    this.channel = options.channel ?? "ingestion_jobs";
    this.onNotify = options.onNotify;
    this.logger = options.logger ?? { info: () => {}, error: (msg, cause) => console.error(`[JobListener] ${msg}`, cause) };
  }

  async start(): Promise<void> {
    if (this.client) {
      return;
    }
    const client = await this.pool.connect();
    this.client = client;
    client.on("notification", () => {
      if (this.stopped || this.running) {
        return;
      }
      this.running = true;
      Promise.resolve(this.onNotify())
        .catch((err) => this.logger.error("onNotify falhou", err))
        .finally(() => {
          this.running = false;
        });
    });
    client.on("error", (err) => {
      this.logger.error("cliente do LISTEN falhou", err);
    });
    await client.query(`LISTEN ${this.channel}`);
    this.logger.info(`LISTEN ${this.channel} ativo`);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (!this.client) {
      return;
    }
    try {
      await this.client.query(`UNLISTEN ${this.channel}`);
    } catch {
      // best-effort — o shutdown não pode falhar porque o canal não
      // está mais lá.
    }
    this.client.release();
    this.client = null;
    this.logger.info(`LISTEN ${this.channel} encerrado`);
  }
}
