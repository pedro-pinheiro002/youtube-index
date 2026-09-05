import type pg from "pg";
import type { IngestionQueue, IngestionJobRow } from "./ingestion-queue.js";
import { mapIngestionJobRow } from "./ingestion-queue.js";
import type { Job } from "./types.js";

const RECOVERY_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Implementação Postgres da Fila de Ingestão. Espelha `SqliteIngestionQueue`
 * na superfície — mesmos métodos, mesma semântica de FIFO + recuperação
 * de jobs órfãos — escrevendo contra um `pg.Pool` parametrizado.
 *
 * `claimNext` usa `SELECT … FOR UPDATE SKIP LOCKED` dentro de um CTE para
 * escolher e travar o próximo job numa única ida ao banco: o `SKIP LOCKED`
 * permite que múltiplos workers (ou várias réplicas da api no futuro)
 * disputem a fila sem bloquear uns aos outros. O CTE devolve o id do
 * candidato; o `UPDATE` externo marca o job como `running` e o
 * `RETURNING` traz a linha já atualizada.
 *
 * A janela de recuperação (5 min) preserva o comportamento do SQLite:
 * jobs em `running` cuja `created_at` é anterior a `now - 5min` voltam
 * para `queued` antes da próxima reivindicação. Isso é o suficiente
 * para destravar a fila depois de um crash do worker.
 *
 * `pool.query` retorna `BIGINT` como `number` graças ao parser registrado
 * em `postgres.ts` (oid 20 → Number), então `row.id` casa com o tipo
 * `number` do contrato `Job`.
 */
export class PostgresIngestionQueue implements IngestionQueue {
  private readonly pool: pg.Pool;
  private readonly now: () => Date;

  constructor(pool: pg.Pool, now: () => Date = () => new Date()) {
    this.pool = pool;
    this.now = now;
  }

  async enqueue(channelId: string): Promise<Job> {
    const createdAt = this.now().toISOString();
    const res = await this.pool.query<IngestionJobRow>(
      `INSERT INTO ingestion_jobs (channel_id, status, created_at)
       VALUES ($1, 'queued', $2)
       RETURNING id, channel_id, status, created_at`,
      [channelId, createdAt],
    );
    // Acorda o loop em-processo do api (#47): o subscriber de
    // `LISTEN ingestion_jobs` recebe o payload e dispara `runNextJob`
    // imediatamente, sem esperar pelo próximo tick do `setInterval`.
    // `NOTIFY` não aceita placeholders ($1) — o payload precisa ser
    // uma literal SQL; escapamos aspas duplas para evitar SQL injection
    // caso channelId contenha caracteres especiais.
    const jobId = String(res.rows[0]?.id ?? "");
    const channelIdEscaped = channelId.replace(/"/g, '\\"');
    await this.pool.query(`NOTIFY ingestion_jobs, '${jobId}:${channelIdEscaped}'`);
    // `INSERT … RETURNING` sempre devolve uma linha quando o INSERT
    // sucede (a falha joga uma exceção diferente); sem o guard, este
    // método fica simétrico com a implementação SQLite.
    return mapIngestionJobRow(res.rows[0] as IngestionJobRow);
  }

  async claimNext(): Promise<Job | null> {
    const cutoff = new Date(this.now().getTime() - RECOVERY_THRESHOLD_MS).toISOString();
    // 1. Recupera jobs travados há mais que a janela de recuperação.
    //    `running` → `queued` libera o candidato para a próxima seleção.
    await this.pool.query(
      `UPDATE ingestion_jobs
       SET status = 'queued'
       WHERE status = 'running' AND created_at < $1`,
      [cutoff],
    );

    // 2. Escolhe e trava o próximo job numa única sentença. O CTE
    //    garante que `SELECT FOR UPDATE SKIP LOCKED` é avaliado antes do
    //    `UPDATE`, e o lock é mantido pela transação implícita até o
    //    final do statement.
    const res = await this.pool.query<IngestionJobRow>(
      `WITH next_job AS (
         SELECT id FROM ingestion_jobs
         WHERE status = 'queued'
         ORDER BY id
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE ingestion_jobs
       SET status = 'running'
       WHERE id IN (SELECT id FROM next_job)
       RETURNING id, channel_id, status, created_at`,
    );
    const row = res.rows[0];
    if (!row) {
      return null;
    }
    return mapIngestionJobRow(row);
  }

  async complete(jobId: number): Promise<void> {
    await this.pool.query(`UPDATE ingestion_jobs SET status = 'completed' WHERE id = $1`, [jobId]);
  }

  async fail(jobId: number): Promise<void> {
    await this.pool.query(`UPDATE ingestion_jobs SET status = 'failed' WHERE id = $1`, [jobId]);
  }

  async listJobs(channelId: string): Promise<Job[]> {
    const res = await this.pool.query<IngestionJobRow>(
      `SELECT id, channel_id, status, created_at
       FROM ingestion_jobs
       WHERE channel_id = $1
       ORDER BY id`,
      [channelId],
    );
    return res.rows.map(mapIngestionJobRow);
  }
}