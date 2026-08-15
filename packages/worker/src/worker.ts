import type { Ingestion, Ledger } from "@youtube-index/domain";

export interface WorkerDeps {
  ledger: Ledger;
  ingestion: Ingestion;
}

export async function pollOnce(deps: WorkerDeps): Promise<boolean> {
  const job = deps.ledger.claimNextJob();
  if (!job) {
    return false;
  }
  try {
    await deps.ingestion.runJob(job.channelId);
    deps.ledger.completeJob(job.id);
  } catch (err) {
    deps.ledger.failJob(job.id);
    throw err;
  }
  return true;
}