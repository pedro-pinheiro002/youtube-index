import type { IngestionQueue } from "./ingestion-queue.js";
import type { Job } from "./types.js";
import { NotImplementedError } from "./postgres-schema.js";

/**
 * Stub da Fila de Ingestão Postgres para o slice #42. Mantém o mesmo
 * formato de `IngestionQueue` para que `createServices` consiga montar
 * um `Services` completo quando recebe um `pg.Pool`; cada método lança
 * `NotImplementedError` apontando para #44, que é a slice que vai
 * implementar a fila Postgres-backed (tabela `ingestion_jobs` já existe
 * no schema; falta o worker in-process alimentado por LISTEN/NOTIFY).
 */
export class PostgresIngestionQueue implements IngestionQueue {
  enqueue(_channelId: string): Job {
    throw new NotImplementedError("enqueue", "PostgresIngestionQueue", "#44");
  }
  claimNext(): Job | null {
    throw new NotImplementedError("claimNext", "PostgresIngestionQueue", "#44");
  }
  complete(_jobId: number): void {
    throw new NotImplementedError("complete", "PostgresIngestionQueue", "#44");
  }
  fail(_jobId: number): void {
    throw new NotImplementedError("fail", "PostgresIngestionQueue", "#44");
  }
  listJobs(_channelId: string): Job[] {
    throw new NotImplementedError("listJobs", "PostgresIngestionQueue", "#44");
  }
}
