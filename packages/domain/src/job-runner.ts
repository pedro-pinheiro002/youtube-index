import type { Ingestion } from "./ingestion.js";
import type { IngestionQueue } from "./ingestion-queue.js";

/**
 * Loop tick do Worker. Tenta pegar o próximo Job da fila e processá-lo
 * via `Ingestion`. Devolve `true` quando um Job foi executado, `false`
 * quando a fila está vazia. Lançar o erro para o caller é parte do
 * contrato: a falha de um Job é registrada em `queue.fail(...)` antes
 * do re-throw, mas a propagação permite que o caller decida se quer
 * logar/exit/continuar.
 *
 * Esta função mora no domain (e não no worker) porque tanto o worker
 * standalone (pacote `packages/worker`) quanto o api em-processo
 * (#47) precisam dela sem duplicar lógica.
 */
export interface JobRunnerDeps {
  queue: IngestionQueue;
  ingestion: Ingestion;
}

export async function runNextJob(deps: JobRunnerDeps): Promise<boolean> {
  const job = await deps.queue.claimNext();
  if (!job) {
    return false;
  }
  try {
    await deps.ingestion.runJob(job.channelId);
    await deps.queue.complete(job.id);
  } catch (err) {
    await deps.queue.fail(job.id);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`job ${job.id} do canal ${job.channelId} falhou: ${message}`, { cause: err });
  }
  return true;
}
