import type { Ingestion, IngestionQueue } from "@youtube-index/domain";

export interface WorkerDeps {
  fila: IngestionQueue;
  ingestion: Ingestion;
}

export async function pollOnce(deps: WorkerDeps): Promise<boolean> {
  const job = deps.fila.claimNext();
  if (!job) {
    return false;
  }
  try {
    await deps.ingestion.runJob(job.channelId);
    deps.fila.complete(job.id);
  } catch (err) {
    deps.fila.fail(job.id);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`job ${job.id} do canal ${job.channelId} falhou: ${message}`, { cause: err });
  }
  return true;
}
