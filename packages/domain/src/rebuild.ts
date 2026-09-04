import {
  type Documento,
  type Projection,
  toCommentDocument,
  toSegmentDocument,
  toVideoDocument,
} from "./documento.js";
import type { Ledger, VideoContext } from "./ledger.js";
import { PHASES, type PhaseMeta } from "./phases.js";

export interface RebuildDeps {
  ledger: Pick<Ledger, "listVideos">;
  projection: Projection;
}

async function rebuildProjection<T>(
  channelId: string,
  records: T[],
  getContext: (record: T) => Promise<VideoContext | null>,
  toDocument: (record: T, videoContext: VideoContext) => Documento,
  projection: Projection,
): Promise<number> {
  const documents: Documento[] = [];
  for (const record of records) {
    const context = await getContext(record);
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
  const videos = await deps.ledger.listVideos(channelId);
  return rebuildProjection(
    channelId,
    videos,
    async (video) => video,
    toVideoDocument,
    deps.projection,
  );
}

export interface RebuildCommentsDeps {
  ledger: Pick<Ledger, "listComments" | "videoContext">;
  projection: Projection;
}

export async function rebuildCommentsProjection(channelId: string, deps: RebuildCommentsDeps): Promise<number> {
  const comments = await deps.ledger.listComments(channelId);
  return rebuildProjection(
    channelId,
    comments,
    async (comment) => deps.ledger.videoContext(comment.videoId),
    toCommentDocument,
    deps.projection,
  );
}

export interface RebuildTranscriptsDeps {
  ledger: Pick<Ledger, "listTranscriptSegments" | "videoContext">;
  projection: Projection;
}

export async function rebuildTranscriptsProjection(channelId: string, deps: RebuildTranscriptsDeps): Promise<number> {
  const segments = await deps.ledger.listTranscriptSegments(channelId);
  return rebuildProjection(
    channelId,
    segments,
    async (segment) => deps.ledger.videoContext(segment.videoId),
    toSegmentDocument,
    deps.projection,
  );
}

export interface RebuildAllDeps {
  ledger: Pick<Ledger, "listVideos" | "listComments" | "listTranscriptSegments" | "videoContext">;
  projection: Projection;
}

/**
 * Rebuilds every projection phase in registry order (see #20), dispatching per
 * `phase.key` to the matching rebuild fn and summing the document counts. The
 * registry can be overridden (e.g. a fake subset) for testing.
 */
export async function rebuildAllProjections(
  channelId: string,
  deps: RebuildAllDeps,
  phases: readonly PhaseMeta[] = PHASES,
): Promise<number> {
  let total = 0;
  for (const phase of phases) {
    switch (phase.key) {
      case "videos":
        total += await rebuildVideosProjection(channelId, { ledger: deps.ledger, projection: deps.projection });
        break;
      case "comments":
        total += await rebuildCommentsProjection(channelId, { ledger: deps.ledger, projection: deps.projection });
        break;
      case "transcripts":
        total += await rebuildTranscriptsProjection(channelId, { ledger: deps.ledger, projection: deps.projection });
        break;
      default: {
        const _exhaustive: never = phase.key;
        throw new Error(`Unbuilt phase: ${_exhaustive}`);
      }
    }
  }
  return total;
}