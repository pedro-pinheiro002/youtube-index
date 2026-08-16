import {
  type Documento,
  type Projection,
  toCommentDocument,
  toSegmentDocument,
  toVideoDocument,
} from "./documento.js";
import type { Ledger, VideoContext } from "./ledger.js";

export interface RebuildDeps {
  ledger: Pick<Ledger, "listVideos">;
  projection: Projection;
}

async function rebuildProjection<T>(
  channelId: string,
  records: T[],
  getContext: (record: T) => VideoContext | null,
  toDocument: (record: T, videoContext: VideoContext) => Documento,
  projection: Projection,
): Promise<number> {
  const documents: Documento[] = [];
  for (const record of records) {
    const context = getContext(record);
    if (context) {
      documents.push(toDocument(record, context));
    }
  }
  if (documents.length > 0) {
    await projection.addDocuments(channelId, documents);
  }
  return documents.length;
}

export async function rebuildVideosProjection(channelId: string, deps: RebuildDeps): Promise<number> {
  return rebuildProjection(
    channelId,
    deps.ledger.listVideos(channelId),
    (video) => video,
    toVideoDocument,
    deps.projection,
  );
}

export interface RebuildCommentsDeps {
  ledger: Pick<Ledger, "listComments" | "videoContext">;
  projection: Projection;
}

export async function rebuildCommentsProjection(channelId: string, deps: RebuildCommentsDeps): Promise<number> {
  return rebuildProjection(
    channelId,
    deps.ledger.listComments(channelId),
    (comment) => deps.ledger.videoContext(comment.videoId),
    toCommentDocument,
    deps.projection,
  );
}

export interface RebuildTranscriptsDeps {
  ledger: Pick<Ledger, "listTranscriptSegments" | "videoContext">;
  projection: Projection;
}

export async function rebuildTranscriptsProjection(channelId: string, deps: RebuildTranscriptsDeps): Promise<number> {
  return rebuildProjection(
    channelId,
    deps.ledger.listTranscriptSegments(channelId),
    (segment) => deps.ledger.videoContext(segment.videoId),
    toSegmentDocument,
    deps.projection,
  );
}
