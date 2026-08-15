import type { Ledger } from "./ledger.js";
import type { Projection, SearchDocument } from "./projection.js";
import { toCommentDocument, toVideoDocument } from "./projection.js";

export interface RebuildDeps {
  ledger: Pick<Ledger, "listVideos">;
  projection: Projection;
}

async function rebuildProjection<T>(
  channelId: string,
  records: T[],
  toDocument: (record: T) => SearchDocument,
  projection: Projection,
): Promise<number> {
  const documents = records.map(toDocument);
  if (documents.length > 0) {
    await projection.addDocuments(channelId, documents);
  }
  return documents.length;
}

export async function rebuildVideosProjection(channelId: string, deps: RebuildDeps): Promise<number> {
  return rebuildProjection(channelId, deps.ledger.listVideos(channelId), toVideoDocument, deps.projection);
}

export interface RebuildCommentsDeps {
  ledger: Pick<Ledger, "listComments">;
  projection: Projection;
}

export async function rebuildCommentsProjection(channelId: string, deps: RebuildCommentsDeps): Promise<number> {
  return rebuildProjection(channelId, deps.ledger.listComments(channelId), toCommentDocument, deps.projection);
}
