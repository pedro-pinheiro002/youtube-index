import type { Ledger } from "./ledger.js";
import type { Projection } from "./projection.js";
import { toVideoDocument } from "./projection.js";

export interface RebuildDeps {
  ledger: Pick<Ledger, "listVideos">;
  projection: Projection;
}

export async function rebuildVideosProjection(channelId: string, deps: RebuildDeps): Promise<number> {
  const videos = deps.ledger.listVideos(channelId);
  const documents = videos.map(toVideoDocument);
  if (documents.length > 0) {
    await deps.projection.addDocuments(channelId, documents);
  }
  return documents.length;
}
