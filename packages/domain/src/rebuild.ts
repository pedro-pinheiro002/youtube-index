import {
  type Documento,
  type Projection,
  toCommentDocument,
  toSegmentDocument,
  toVideoDocument,
} from "./documento.js";
import type { Ledger } from "./ledger.js";

export interface RebuildDeps {
  ledger: Pick<Ledger, "listVideos">;
  projection: Projection;
}

async function rebuildProjection<T>(
  channelId: string,
  records: T[],
  toDocument: (record: T) => Documento,
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

export interface RebuildTranscriptsDeps {
  ledger: Pick<Ledger, "listTranscriptSegments">;
  projection: Projection;
}

export async function rebuildTranscriptsProjection(channelId: string, deps: RebuildTranscriptsDeps): Promise<number> {
  return rebuildProjection(channelId, deps.ledger.listTranscriptSegments(channelId), toSegmentDocument, deps.projection);
}
