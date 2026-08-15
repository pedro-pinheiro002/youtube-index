import type { CommentRecord, Ledger, TranscriptSegmentRecord, VideoRecord } from "./ledger.js";
import type { Projection } from "./projection.js";
import { toCommentDocument, toSegmentDocument, toVideoDocument } from "./projection.js";
import type { TranscriptFetcher } from "./transcripts.js";
import type { PhaseKey, PhaseStatus } from "./types.js";
import { CommentsDisabledError, type YouTubeClient } from "./youtube.js";

export interface IngestionDeps {
  youtube: YouTubeClient;
  transcripts: TranscriptFetcher;
  ledger: Ledger;
  projection: Projection;
  recentWindowDays?: number;
}

export interface Ingestion {
  runJob(channelId: string): Promise<void>;
  runVideosPhase(channelId: string): Promise<void>;
  runCommentsPhase(channelId: string): Promise<void>;
  runTranscriptsPhase(channelId: string): Promise<void>;
}

const DEFAULT_RECENT_WINDOW_DAYS = 30;

function isRecent(publishedAt: string, windowDays: number): boolean {
  const published = Date.parse(publishedAt);
  if (Number.isNaN(published)) {
    return false;
  }
  return published >= Date.now() - windowDays * 86_400_000;
}

export function createIngestion(deps: IngestionDeps): Ingestion {
  const recentWindowDays = deps.recentWindowDays ?? DEFAULT_RECENT_WINDOW_DAYS;

  function phaseStatus(channelId: string, phase: PhaseKey): PhaseStatus {
    return deps.ledger.getChannel(channelId)?.phases[phase].status ?? "pending";
  }

  async function runVideosPhase(channelId: string): Promise<void> {
    const priorStatus = phaseStatus(channelId, "videos");
    const canStopEarly = priorStatus === "completed";
    const uploadsPlaylistId = await deps.youtube.getUploadsPlaylistId(channelId);
    deps.ledger.updatePhase(channelId, "videos", { status: "running" });

    let pageToken: string | null = null;
    let done = 0;
    const records: VideoRecord[] = [];
    do {
      const page = await deps.youtube.listUploads(uploadsPlaylistId, pageToken);
      let stop = false;
      for (const video of page.videos) {
        const known = deps.ledger.hasVideo(video.id);
        if (canStopEarly && known) {
          done += 1;
          deps.ledger.updatePhase(channelId, "videos", { done });
          stop = true;
          break;
        }
        if (!known) {
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
        }
        done += 1;
        deps.ledger.updatePhase(channelId, "videos", { done });
      }
      pageToken = stop ? null : page.nextPageToken;
    } while (pageToken);

    await deps.projection.addDocuments(channelId, records.map(toVideoDocument));
    deps.ledger.updatePhase(channelId, "videos", { status: "completed", total: done });
  }

  async function runCommentsPhase(channelId: string): Promise<void> {
    const priorStatus = phaseStatus(channelId, "comments");
    const isSync = priorStatus === "completed";
    const videos = deps.ledger.listVideos(channelId);
    deps.ledger.updatePhase(channelId, "comments", { status: "running" });

    let done = 0;
    const records: CommentRecord[] = [];
    for (const video of videos) {
      if (isSync) {
        if (!isRecent(video.publishedAt, recentWindowDays)) {
          done += 1;
          continue;
        }
      } else if (deps.ledger.hasCommentIngestion(video.id)) {
        done += 1;
        continue;
      }
      try {
        const comments = await deps.youtube.listComments(video.id);
        if (comments.length === 0) {
          deps.ledger.markCommentAbsence(video.id, "none");
        } else {
          deps.ledger.deleteCommentsForVideo(video.id);
          deps.ledger.clearCommentAbsence(video.id);
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
        }
      } catch (err) {
        if (!(err instanceof CommentsDisabledError)) {
          throw err;
        }
        deps.ledger.markCommentAbsence(video.id, "disabled");
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
      if (deps.ledger.hasTranscriptIngestion(video.id)) {
        done += 1;
        continue;
      }
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