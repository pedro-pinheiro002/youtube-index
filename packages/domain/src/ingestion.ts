import type { Ledger, VideoRecord } from "./ledger.js";
import type { Projection } from "./projection.js";
import { toVideoDocument } from "./projection.js";
import type { TranscriptFetcher } from "./transcripts.js";
import type { YouTubeClient } from "./youtube.js";

export interface IngestionDeps {
  youtube: YouTubeClient;
  transcripts: TranscriptFetcher;
  ledger: Ledger;
  projection: Projection;
}

export interface Ingestion {
  runJob(channelId: string): Promise<void>;
  runVideosPhase(channelId: string): Promise<void>;
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

  async function runJob(channelId: string): Promise<void> {
    deps.ledger.setChannelStatus(channelId, "ingesting");
    try {
      await runVideosPhase(channelId);
    } catch (err) {
      deps.ledger.setChannelStatus(channelId, "failed");
      deps.ledger.updatePhase(channelId, "videos", { status: "failed" });
      throw err;
    }
    deps.ledger.setChannelStatus(channelId, "completed");
  }

  return { runJob, runVideosPhase };
}