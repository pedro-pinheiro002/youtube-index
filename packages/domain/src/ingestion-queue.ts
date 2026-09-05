import type { Job } from "./types.js";

/**
 * Contrato da Fila de Ingestão — uma fila FIFO persistente que
 * entrega Jobs para o loop em-processo do api (#47). Implementações
 * concretas vivem em `postgres-queue.ts`.
 */
export interface IngestionQueue {
  enqueue(channelId: string): Promise<Job>;
  claimNext(): Promise<Job | null>;
  complete(jobId: number): Promise<void>;
  fail(jobId: number): Promise<void>;
  listJobs(channelId: string): Promise<Job[]>;
}

export interface IngestionJobRow {
  id: number | string;
  channel_id: string;
  status: string;
  created_at: string;
}

export function mapIngestionJobRow(row: IngestionJobRow): Job {
  return {
    id: typeof row.id === "string" ? Number(row.id) : row.id,
    channelId: row.channel_id,
    status: row.status as Job["status"],
    createdAt: row.created_at,
  };
}
