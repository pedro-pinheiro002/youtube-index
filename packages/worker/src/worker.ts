import type { Ingestion, IngestionQueue } from "@youtube-index/domain";
export type { JobRunnerDeps } from "@youtube-index/domain";

/**
 * @deprecated Use `runNextJob` de `@youtube-index/domain` (slice #47).
 * Mantida apenas como alias para preservar imports externos durante a
 * transição.
 */
export async function pollOnce(deps: {
  queue: IngestionQueue;
  ingestion: Ingestion;
}): Promise<boolean> {
  const { runNextJob } = await import("@youtube-index/domain");
  return runNextJob(deps);
}

export { runNextJob } from "@youtube-index/domain";
