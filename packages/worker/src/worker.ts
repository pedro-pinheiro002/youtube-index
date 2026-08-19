import type { Ingestion, IngestionQueue } from "@youtube-index/domain";

export interface WorkerDeps {
  queue: IngestionQueue;
  ingestion: Ingestion;
}

export async function pollOnce(deps: WorkerDeps): Promise<boolean> {
  const job = deps.queue.claimNext();
  if (!job) {
    return false;
  }
  try {
    await deps.ingestion.runJob(job.channelId);
    deps.queue.complete(job.id);
  } catch (err) {
    deps.queue.fail(job.id);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`job ${job.id} do canal ${job.channelId} falhou: ${message}`, { cause: err });
  }
  return true;
}
