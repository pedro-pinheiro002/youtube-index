import type { DatabaseSync } from "node:sqlite";
import type { Job } from "./types.js";

const RECOVERY_THRESHOLD_MS = 5 * 60 * 1000;

export interface IngestionQueue {
  enqueue(channelId: string): Promise<Job>;
  claimNext(): Promise<Job | null>;
  complete(jobId: number): Promise<void>;
  fail(jobId: number): Promise<void>;
  listJobs(channelId: string): Promise<Job[]>;
}

/**
 * Forma crua de uma linha de `ingestion_jobs` (snake_case das colunas).
 * Exportada para que `PostgresIngestionQueue` reaproveite o mesmo tipo
 * em vez de redefinir `JobRow` localmente — `node-postgres` devolve as
 * colunas no mesmo formato que `node:sqlite`.
 */
export interface IngestionJobRow {
  id: number;
  channel_id: string;
  status: Job["status"];
  created_at: string;
}

/**
 * Converte uma linha da Fila (snake_case das colunas) no `Job` do
 * domínio (camelCase). Único ponto de verdade para a tradução, usado
 * por ambas as implementações.
 */
export function mapIngestionJobRow(row: IngestionJobRow): Job {
  return {
    id: row.id,
    channelId: row.channel_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

/**
 * Implementação SQLite da Fila de Ingestão. Mantida para o caminho de
 * testes rápidos (`:memory:`, sem contêiner Postgres); em produção a
 * factory `createServices` seleciona `PostgresIngestionQueue` quando
 * recebe um `pg.Pool`.
 *
 * Métodos declarados como `async` para alinhar com a versão Postgres
 * (`node-postgres` é intrinsecamente assíncrono). O trabalho aqui é
 * síncrono dentro de `node:sqlite`, mas embrulhar em `Promise.resolve`
 * mantém a interface uniforme — callers podem sempre `await`.
 */
export class SqliteIngestionQueue implements IngestionQueue {
  private readonly db: DatabaseSync;
  private readonly now: () => Date;

  constructor(db: DatabaseSync, now: () => Date = () => new Date()) {
    this.db = db;
    this.now = now;
  }

  async enqueue(channelId: string): Promise<Job> {
    const createdAt = this.now().toISOString();
    const result = this.db
      .prepare("INSERT INTO ingestion_jobs (channel_id, status, created_at) VALUES (?, 'queued', ?)")
      .run(channelId, createdAt);
    const id = Number(result.lastInsertRowid);
    return { id, channelId, status: "queued", createdAt };
  }

  async claimNext(): Promise<Job | null> {
    const cutoff = new Date(this.now().getTime() - RECOVERY_THRESHOLD_MS).toISOString();
    this.db
      .prepare("UPDATE ingestion_jobs SET status = 'queued' WHERE status = 'running' AND created_at < ?")
      .run(cutoff);

    const row = this.db
      .prepare(
        "SELECT id, channel_id, status, created_at FROM ingestion_jobs WHERE status = 'queued' ORDER BY id LIMIT 1",
      )
      .get() as unknown as IngestionJobRow | undefined;
    if (!row) {
      return null;
    }
    this.db.prepare("UPDATE ingestion_jobs SET status = 'running' WHERE id = ?").run(row.id);
    return { id: row.id, channelId: row.channel_id, status: "running", createdAt: row.created_at };
  }

  async complete(jobId: number): Promise<void> {
    this.db.prepare("UPDATE ingestion_jobs SET status = 'completed' WHERE id = ?").run(jobId);
  }

  async fail(jobId: number): Promise<void> {
    this.db.prepare("UPDATE ingestion_jobs SET status = 'failed' WHERE id = ?").run(jobId);
  }

  async listJobs(channelId: string): Promise<Job[]> {
    const rows = this.db
      .prepare("SELECT id, channel_id, status, created_at FROM ingestion_jobs WHERE channel_id = ? ORDER BY id")
      .all(channelId) as unknown as IngestionJobRow[];
    return rows.map(mapIngestionJobRow);
  }
}