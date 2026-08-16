import {
  type CommentSearchDocument,
  type Projection,
  type SegmentSearchDocument,
  toCommentDocument,
  toSegmentDocument,
  toVideoDocument,
} from "./documento.js";
import type { CommentRecord, Ledger, TranscriptSegmentRecord, VideoRecord } from "./ledger.js";
import type { TranscriptFetcher } from "./transcripts.js";
import type { PhaseKey, PhaseStatus } from "./types.js";
import { CommentsDisabledError, type YouTubeClient } from "./youtube.js";

export interface IngestionLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  event(event: string, data: Record<string, unknown>): void;
}

export interface IngestionDeps {
  youtube: YouTubeClient;
  transcripts: TranscriptFetcher;
  ledger: Ledger;
  projection: Projection;
  recentWindowDays?: number;
  logger?: IngestionLogger;
}

export interface Ingestion {
  runJob(channelId: string): Promise<void>;
  runVideosPhase(channelId: string): Promise<void>;
  runCommentsPhase(channelId: string): Promise<void>;
  runTranscriptsPhase(channelId: string): Promise<void>;
}

const DEFAULT_RECENT_WINDOW_DAYS = 30;

const NOOP_LOGGER: IngestionLogger = {
  info() {},
  warn() {},
  error() {},
  event() {},
};

function isRecent(publishedAt: string, windowDays: number): boolean {
  const published = Date.parse(publishedAt);
  if (Number.isNaN(published)) {
    return false;
  }
  return published >= Date.now() - windowDays * 86_400_000;
}

export function createIngestion(deps: IngestionDeps): Ingestion {
  const recentWindowDays = deps.recentWindowDays ?? DEFAULT_RECENT_WINDOW_DAYS;
  const log = deps.logger ?? NOOP_LOGGER;

  function phaseStatus(channelId: string, phase: PhaseKey): PhaseStatus {
    return deps.ledger.getChannel(channelId)?.phases[phase].status ?? "pending";
  }

  async function runVideosPhase(channelId: string): Promise<void> {
    const priorStatus = phaseStatus(channelId, "videos");
    const canStopEarly = priorStatus === "completed";
    const uploadsPlaylistId = await deps.youtube.getUploadsPlaylistId(channelId);
    deps.ledger.updatePhase(channelId, "videos", { status: "running" });
    log.event("phase:started", { phase: "videos", channelId });
    log.info(`[${channelId}] fase videos: listando vídeos da playlist ${uploadsPlaylistId}...`);

    let pageToken: string | null = null;
    let done = 0;
    let added = 0;
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
            added += 1;
          } else {
            log.warn(`[${channelId}] vídeo ${video.id} sem métricas (removido/indisponível); pulado`);
            log.event("video:skipped", { phase: "videos", channelId, videoId: video.id, reason: "no-metrics" });
          }
        }
        done += 1;
        deps.ledger.updatePhase(channelId, "videos", { done });
        log.event("video:processed", { phase: "videos", channelId, videoId: video.id });
      }
      pageToken = stop ? null : page.nextPageToken;
    } while (pageToken);

    await deps.projection.addDocuments(channelId, records.map(toVideoDocument));
    deps.ledger.updatePhase(channelId, "videos", { status: "completed", total: done });
    log.event("phase:completed", { phase: "videos", channelId, total: done });
    log.info(`[${channelId}] fase videos concluída: ${done} vídeos (${added} novos)`);
  }

  async function runCommentsPhase(channelId: string): Promise<void> {
    const priorStatus = phaseStatus(channelId, "comments");
    const isSync = priorStatus === "completed";
    const videos = deps.ledger.listVideos(channelId);
    deps.ledger.updatePhase(channelId, "comments", { status: "running", total: videos.length });
    log.event("phase:started", { phase: "comments", channelId });
    log.info(`[${channelId}] fase comments: buscando comentários de ${videos.length} vídeos...`);

    let done = 0;
    let added = 0;
    const documents: CommentSearchDocument[] = [];
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
        // Na Sincronização, o conjunto de Comentários pode ter mudado de duas
        // formas: (a) o top-50 mudou (alguns saíram, outros entraram) ou
        // (b) o Vídeo antes tinha Comentários e agora não tem mais. Em ambos
        // os casos varr os Documentos stale do Vídeo no Índice antes de
        // re-projetar — sem isso, o Índice mantém Documentos de Comentários
        // que já saíram e voltariam a aparecer em Buscas.
        if (isSync && (comments.length === 0 || deps.ledger.hasCommentIngestion(video.id))) {
          await deps.projection.remove(channelId, (hit) => hit.type === "comment" && hit.videoId === video.id);
        }
        if (comments.length === 0) {
          deps.ledger.deleteCommentsForVideo(video.id);
          deps.ledger.markCommentAbsence(video.id, "none");
        } else {
          deps.ledger.deleteCommentsForVideo(video.id);
          deps.ledger.clearCommentAbsence(video.id);
          const context = deps.ledger.videoContext(video.id);
          if (!context) {
            throw new Error(`vídeo ${video.id} sem contexto no Ledger`);
          }
          for (const comment of comments) {
            const record: CommentRecord = {
              id: comment.id,
              videoId: video.id,
              channelId,
              author: comment.author,
              text: comment.text,
              likes: comment.likes,
              publishedAt: comment.publishedAt,
            };
            deps.ledger.upsertComment(record);
            documents.push(toCommentDocument(record, context));
            added += 1;
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
      log.event("video:processed", { phase: "comments", channelId, videoId: video.id });
    }

    await deps.projection.addDocuments(channelId, documents);
    deps.ledger.updatePhase(channelId, "comments", { status: "completed", total: videos.length });
    log.event("phase:completed", { phase: "comments", channelId, total: videos.length });
    log.info(`[${channelId}] fase comments concluída: ${done}/${videos.length} vídeos (${added} comentários)`);
  }

  async function runTranscriptsPhase(channelId: string): Promise<void> {
    const priorStatus = phaseStatus(channelId, "transcripts");
    const isSync = priorStatus === "completed";
    const videos = deps.ledger.listVideos(channelId);
    deps.ledger.updatePhase(channelId, "transcripts", { status: "running", total: videos.length });
    log.event("phase:started", { phase: "transcripts", channelId });
    log.info(`[${channelId}] fase transcripts: buscando transcrições de ${videos.length} vídeos...`);

    let done = 0;
    let added = 0;
    const documents: SegmentSearchDocument[] = [];
    for (const video of videos) {
      if (isSync) {
        // Na Sincronização, só re-processamos Vídeos recentes para apanhar
        // mudanças nas Transcrições (Correções automáticas do YouTube, por
        // exemplo). Vídeos antigos ficam como estão — o custo de reprocessar
        // todos a cada Sincronização não se justifica.
        if (!isRecent(video.publishedAt, recentWindowDays)) {
          done += 1;
          continue;
        }
      } else if (deps.ledger.hasTranscriptIngestion(video.id)) {
        done += 1;
        continue;
      }
      const transcript = await deps.transcripts.fetchTranscript(video.id);
      // Em Sincronização, Segmentos antigos do Vídeo podem ter ficado stale
      // no Índice — a Transcrição pode ter sido corrigida (segmentos
      // diferentes) ou removida. Varre antes de qualquer mudança para não
      // misturar Segmentos novos com antigos em Buscas.
      if (isSync && deps.ledger.hasTranscriptIngestion(video.id)) {
        await deps.projection.remove(channelId, (hit) => hit.type === "segment" && hit.videoId === video.id);
      }
      deps.ledger.deleteTranscriptSegmentsForVideo(video.id);
      if (transcript) {
        const context = deps.ledger.videoContext(video.id);
        if (!context) {
          throw new Error(`vídeo ${video.id} sem contexto no Ledger`);
        }
        for (const segment of transcript.segments) {
          const record: TranscriptSegmentRecord = {
            id: `${video.id}:${segment.start}`,
            videoId: video.id,
            channelId,
            start: segment.start,
            end: segment.start + segment.duration,
            text: segment.text,
          };
          deps.ledger.upsertTranscriptSegment(record);
          documents.push(toSegmentDocument(record, context));
          added += 1;
        }
      } else {
        deps.ledger.markTranscriptAbsent(video.id);
      }
      done += 1;
      deps.ledger.updatePhase(channelId, "transcripts", { done });
      log.event("video:processed", { phase: "transcripts", channelId, videoId: video.id });
    }

    await deps.projection.addDocuments(channelId, documents);
    deps.ledger.updatePhase(channelId, "transcripts", { status: "completed", total: videos.length });
    log.event("phase:completed", { phase: "transcripts", channelId, total: videos.length });
    log.info(`[${channelId}] fase transcripts concluída: ${done}/${videos.length} vídeos (${added} segmentos)`);
  }

  async function runJob(channelId: string): Promise<void> {
    const title = deps.ledger.getChannel(channelId)?.title ?? channelId;
    deps.ledger.setChannelStatus(channelId, "ingesting");
    deps.ledger.clearChannelError(channelId);
    log.info(`[${channelId}] ingestão iniciada: "${title}"`);
    let currentPhase: PhaseKey = "videos";
    try {
      await runVideosPhase(channelId);
      currentPhase = "comments";
      await runCommentsPhase(channelId);
      currentPhase = "transcripts";
      await runTranscriptsPhase(channelId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.ledger.setChannelStatus(channelId, "failed");
      deps.ledger.updatePhase(channelId, currentPhase, { status: "failed" });
      deps.ledger.setChannelError(channelId, message);
      log.error(`[${channelId}] fase "${currentPhase}" falhou: ${message}`);
      throw err;
    }
    deps.ledger.setChannelStatus(channelId, "completed");
    log.info(`[${channelId}] ingestão concluída`);
  }

  return { runJob, runVideosPhase, runCommentsPhase, runTranscriptsPhase };
}