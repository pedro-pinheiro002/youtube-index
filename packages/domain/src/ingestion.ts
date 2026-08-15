import type { CommentRecord, Ledger, TranscriptSegmentRecord, VideoRecord } from "./ledger.js";
import type { Projection } from "./projection.js";
import { toCommentDocument, toSegmentDocument, toVideoDocument } from "./projection.js";
import type { TranscriptFetcher } from "./transcripts.js";
import type { PhaseKey } from "./types.js";
import { CommentsDisabledError, type YouTubeClient } from "./youtube.js";

export interface IngestionDeps {
  youtube: YouTubeClient;
  transcripts: TranscriptFetcher;
  ledger: Ledger;
  projection: Projection;
}

export interface Ingestion {
  runJob(channelId: string): Promise<void>;
  runVideosPhase(channelId: string): Promise<void>;
  runCommentsPhase(channelId: string): Promise<void>;
  runTranscriptsPhase(channelId: string): Promise<void>;
}

export function createIngestion(deps: IngestionDeps): Ingestion {
  async function runVideosPhase(channelId: string): Promise<void> {
    const uploadsPlaylistId = await deps.youtube.getUploadsPlaylistId(channelId);
    deps.ledger.updatePhase(channelId, "videos", { status: "running" });

    let pageToken: string | null = null;
    let done = 0;
    const records: VideoRecord[] = [];
    do {
      const page = await deps.youtube.listUploads(uploadsPlaylistId, pageToken);
      for (const video of page.videos) {
        const stats = await deps.youtube.getVideoStats(video.id);
        if (stats) {
          const record: VideoRecord = {
            id: video.id,
            channelId,
            title: video.title,
            description: video.description,
            publishedAt: video.publishedAt,
            views: stats.views,
            likes: stats.likes,
            durationSeconds: stats.durationSeconds,
          };
          deps.ledger.upsertVideo(record);
          records.push(record);
        }
        done += 1;
        deps.ledger.updatePhase(channelId, "videos", { done });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);

    await deps.projection.addDocuments(channelId, records.map(toVideoDocument));
    deps.ledger.updatePhase(channelId, "videos", { status: "completed", total: done });
  }

  async function runCommentsPhase(channelId: string): Promise<void> {
    const videos = deps.ledger.listVideos(channelId);
    deps.ledger.updatePhase(channelId, "comments", { status: "running" });

    let done = 0;
    const records: CommentRecord[] = [];
    for (const video of videos) {
      try {
        const comments = await deps.youtube.listComments(video.id);
        for (const comment of comments) {
          const record: CommentRecord = {
            id: comment.id,
            videoId: video.id,
            channelId,
            videoTitle: video.title,
            author: comment.author,
            text: comment.text,
            likes: comment.likes,
            publishedAt: comment.publishedAt,
          };
          deps.ledger.upsertComment(record);
          records.push(record);
        }
      } catch (err) {
        if (!(err instanceof CommentsDisabledError)) {
          throw err;
        }
      }
      done += 1;
      deps.ledger.updatePhase(channelId, "comments", { done });
    }

    await deps.projection.addDocuments(channelId, records.map(toCommentDocument));
    deps.ledger.updatePhase(channelId, "comments", { status: "completed", total: done });
  }

  async function runTranscriptsPhase(channelId: string): Promise<void> {
    const videos = deps.ledger.listVideos(channelId);
    deps.ledger.updatePhase(channelId, "transcripts", { status: "running" });

    let done = 0;
    const records: TranscriptSegmentRecord[] = [];
    for (const video of videos) {
      const transcript = await deps.transcripts.fetchTranscript(video.id);
      if (transcript) {
        for (const segment of transcript.segments) {
          const record: TranscriptSegmentRecord = {
            id: `${video.id}:${segment.start}`,
            videoId: video.id,
            channelId,
            videoTitle: video.title,
            videoPublishedAt: video.publishedAt,
            start: segment.start,
            end: segment.start + segment.duration,
            text: segment.text,
          };
          deps.ledger.upsertTranscriptSegment(record);
          records.push(record);
        }
      } else {
        deps.ledger.markTranscriptAbsent(video.id);
      }
      done += 1;
      deps.ledger.updatePhase(channelId, "transcripts", { done });
    }

    await deps.projection.addDocuments(channelId, records.map(toSegmentDocument));
    deps.ledger.updatePhase(channelId, "transcripts", { status: "completed", total: done });
  }

  async function runJob(channelId: string): Promise<void> {
    deps.ledger.setChannelStatus(channelId, "ingesting");
    let currentPhase: PhaseKey = "videos";
    try {
      await runVideosPhase(channelId);
      currentPhase = "comments";
      await runCommentsPhase(channelId);
      currentPhase = "transcripts";
      await runTranscriptsPhase(channelId);
    } catch (err) {
      deps.ledger.setChannelStatus(channelId, "failed");
      deps.ledger.updatePhase(channelId, currentPhase, { status: "failed" });
      throw err;
    }
    deps.ledger.setChannelStatus(channelId, "completed");
  }

  return { runJob, runVideosPhase, runCommentsPhase, runTranscriptsPhase };
}