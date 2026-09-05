import type { CommentRecord, Ledger, TranscriptSegmentRecord, VideoRecord } from "./postgres-ledger.js";
import type { TranscriptFetcher } from "./transcripts.js";
import type { PhaseKey, PhaseStatus } from "./types.js";
import { PHASES, type Phase } from "./phases.js";
import { CommentsDisabledError, type YouTubeClient } from "./youtube.js";

export interface IngestionLogger {
  info(message: string): void;
  warn(message: string): void;
  /**
   * Logs a failure. The optional `cause` carries the original `Error` so
   * transient failures (e.g. a `TranscriptResult` of `error`) can be
   * surfaced for debugging — the message alone discards the cause.
   */
  error(message: string, cause?: Error): void;
  event(event: string, data: Record<string, unknown>): void;
}

export interface IngestionDeps {
  youtube: YouTubeClient;
  transcripts: TranscriptFetcher;
  ledger: Ledger;
  recentWindowDays?: number;
  logger?: IngestionLogger;
}

export interface Ingestion {
  runJob(channelId: string): Promise<void>;
}

const DEFAULT_RECENT_WINDOW_DAYS = 30;

const NOOP_LOGGER: IngestionLogger = {
  info() {},
  warn() {},
  error() {},
  event() {},
};

/**
 * Returns `true` when `publishedAt` falls inside the recent window (sync mode
 * re-processes only recent Vídeos for Comentários/Transcrições).
 *
 * Seam contract: an empty/unparseable `publishedAt` returns `false`, so a
 * Vídeo without a parseable timestamp is skipped in sync mode (never treated
 * as recent). This matches the Vídeo record shape, where `publishedAt` is a
 * string sourced from YouTube and is expected to be an ISO 8601 timestamp.
 */
function isRecent(publishedAt: string, windowDays: number): boolean {
  const published = Date.parse(publishedAt);
  if (Number.isNaN(published)) {
    return false;
  }
  return published >= Date.now() - windowDays * 86_400_000;
}

/**
 * Builds the Phase registry — the single source of truth for ingestion phases
 * (see #20). Maps the `PHASES` metadata (key/label/doc/describe) to a `Phase`
 * whose `run` is bound to the given deps. The phase-run logic lives here as
 * closures over `deps`.
 */
export function createPhases(deps: IngestionDeps): readonly Phase[] {
  const recentWindowDays = deps.recentWindowDays ?? DEFAULT_RECENT_WINDOW_DAYS;
  const log = deps.logger ?? NOOP_LOGGER;

  async function phaseStatus(channelId: string, phase: PhaseKey): Promise<PhaseStatus> {
    const channel = await deps.ledger.getChannel(channelId);
    return channel?.phases[phase].status ?? "pending";
  }

  async function runVideosPhase(channelId: string): Promise<void> {
    const priorStatus = await phaseStatus(channelId, "videos");
    const canStopEarly = priorStatus === "completed";
    const uploadsPlaylistId = await deps.youtube.getUploadsPlaylistId(channelId);
    await deps.ledger.updatePhase(channelId, "videos", { status: "running" });
    log.event("phase:started", { phase: "videos", channelId });
    log.info(`[${channelId}] fase videos: listando vídeos da playlist ${uploadsPlaylistId}...`);

    let pageToken: string | null = null;
    let done = 0;
    let added = 0;
    do {
      const page = await deps.youtube.listUploads(uploadsPlaylistId, pageToken);
      let stop = false;
      for (const video of page.videos) {
        const known = await deps.ledger.hasVideo(video.id);
        if (canStopEarly && known) {
          done += 1;
          await deps.ledger.updatePhase(channelId, "videos", { done });
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
            await deps.ledger.upsertVideo(record);
            added += 1;
          } else {
            log.warn(`[${channelId}] vídeo ${video.id} sem métricas (removido/indisponível); pulado`);
            log.event("video:skipped", { phase: "videos", channelId, videoId: video.id, reason: "no-metrics" });
          }
        }
        done += 1;
        await deps.ledger.updatePhase(channelId, "videos", { done });
        log.event("video:processed", { phase: "videos", channelId, videoId: video.id });
      }
      pageToken = stop ? null : page.nextPageToken;
    } while (pageToken);

    // No caminho Postgres os Vídeos são materializados no Ledger e a coluna
    // `fts` é populada na MESMA transação pela `generated always as` —
    // nada precisa ser empurrado para uma Projeção externa (slice #46).
    const videos = await deps.ledger.listVideos(channelId);
    const total = videos.length;
    await deps.ledger.updatePhase(channelId, "videos", { status: "completed", total });
    log.event("phase:completed", { phase: "videos", channelId, total });
    log.info(`[${channelId}] fase videos concluída: ${done} vídeos (${added} novos)`);
  }

  async function runCommentsPhase(channelId: string): Promise<void> {
    const priorStatus = await phaseStatus(channelId, "comments");
    const isSync = priorStatus === "completed";
    const videos = await deps.ledger.listVideos(channelId);
    await deps.ledger.updatePhase(channelId, "comments", { status: "running", total: videos.length });
    log.event("phase:started", { phase: "comments", channelId });
    log.info(`[${channelId}] fase comments: buscando comentários de ${videos.length} vídeos...`);

    let done = 0;
    let added = 0;
    for (const video of videos) {
      if (isSync) {
        if (!isRecent(video.publishedAt, recentWindowDays)) {
          done += 1;
          continue;
        }
      } else if (await deps.ledger.hasCommentIngestion(video.id)) {
        done += 1;
        continue;
      }
      try {
        const comments = await deps.youtube.listComments(video.id);
        // Na Sincronização o conjunto de Comentários pode ter mudado
        // (top-50 mudou, ou Vídeo sem Comentários agora). No caminho
        // Postgres a remoção é implícita: `deleteCommentsForVideo` apaga
        // as linhas e a `fts` das colunas some com elas — não há Índice
        // externo para varrer (slice #46).
        if (comments.length === 0) {
          await deps.ledger.deleteCommentsForVideo(video.id);
          await deps.ledger.markCommentAbsence(video.id, "none");
        } else {
          await deps.ledger.deleteCommentsForVideo(video.id);
          await deps.ledger.clearCommentAbsence(video.id);
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
            await deps.ledger.upsertComment(record);
            added += 1;
          }
        }
      } catch (err) {
        if (!(err instanceof CommentsDisabledError)) {
          throw err;
        }
        await deps.ledger.markCommentAbsence(video.id, "disabled");
      }
      done += 1;
      await deps.ledger.updatePhase(channelId, "comments", { done });
      log.event("video:processed", { phase: "comments", channelId, videoId: video.id });
    }

    // Os Comentários ficam disponíveis para a Busca imediatamente
    // após `upsertComment` porque o Ledger grava a coluna `fts`
    // (gerada) na MESMA transação — slice #46.
    await deps.ledger.updatePhase(channelId, "comments", { status: "completed", total: videos.length });
    log.event("phase:completed", { phase: "comments", channelId, total: videos.length });
    log.info(`[${channelId}] fase comments concluída: ${done}/${videos.length} vídeos (${added} comentários)`);
  }

  async function runTranscriptsPhase(channelId: string): Promise<void> {
    const priorStatus = await phaseStatus(channelId, "transcripts");
    const isSync = priorStatus === "completed";
    const videos = await deps.ledger.listVideos(channelId);
    await deps.ledger.updatePhase(channelId, "transcripts", { status: "running", total: videos.length });
    log.event("phase:started", { phase: "transcripts", channelId });
    log.info(`[${channelId}] fase transcripts: buscando transcrições de ${videos.length} vídeos...`);

    let done = 0;
    let added = 0;
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
      } else if (await deps.ledger.hasTranscriptIngestion(video.id)) {
        done += 1;
        continue;
      }
      const result = await deps.transcripts.fetchTranscript(video.id);
      // `deleteTranscriptSegmentsForVideo` abaixo já cobre o caso de
      // Sincronização onde a Transcrição mudou: a remoção dos Segmentos
      // antigos + o upsert dos novos acontece em uma única janela de
      // execução do Ledger (slice #46 — sem Projeção externa para
      // varrer).
      await deps.ledger.deleteTranscriptSegmentsForVideo(video.id);
      // O contrato discriminado substitui o antigo `Transcript | null`. Os
      // três outcomes são tratados exaustivamente: `transcript` upserta os
      // Segmentos; `absent` marca ausência permanente; `error` lança para a
      // Fase falhar e o Vídeo permanece retriable (sem ausência durável).
      switch (result.kind) {
        case "transcript": {
          for (const segment of result.transcript.segments) {
            const record: TranscriptSegmentRecord = {
              id: `${video.id}:${segment.start}`,
              videoId: video.id,
              channelId,
              start: segment.start,
              end: segment.start + segment.duration,
              text: segment.text,
            };
            await deps.ledger.upsertTranscriptSegment(record);
            added += 1;
          }
          break;
        }
        case "absent": {
          await deps.ledger.markTranscriptAbsent(video.id);
          break;
        }
        case "error": {
          // Falha transitória: NÃO marca ausência (o Vídeo permanece
          // retriable na próxima Sincronização). Lança o cause para o
          // runJob catch marcar a Fase como failed e logar o cause.
          throw result.cause;
        }
      }
      done += 1;
      await deps.ledger.updatePhase(channelId, "transcripts", { done });
      log.event("video:processed", { phase: "transcripts", channelId, videoId: video.id });
    }

    // Os Segmentos ficam disponíveis para a Busca imediatamente após
    // `upsertTranscriptSegment` porque o Ledger grava a coluna `fts`
    // (gerada) na MESMA transação — slice #46.
    await deps.ledger.updatePhase(channelId, "transcripts", { status: "completed", total: videos.length });
    log.event("phase:completed", { phase: "transcripts", channelId, total: videos.length });
    log.info(`[${channelId}] fase transcripts concluída: ${done}/${videos.length} vídeos (${added} segmentos)`);
  }

  const runByKey: Record<PhaseKey, (channelId: string) => Promise<void>> = {
    videos: runVideosPhase,
    comments: runCommentsPhase,
    transcripts: runTranscriptsPhase,
  };

  return PHASES.map((meta) => ({ ...meta, run: runByKey[meta.key] }));
}

export function createIngestion(deps: IngestionDeps, phases: readonly Phase[] = createPhases(deps)) {
  const log = deps.logger ?? NOOP_LOGGER;

  async function runJob(channelId: string): Promise<void> {
    const initial = await deps.ledger.getChannel(channelId);
    const title = initial?.title ?? channelId;
    await deps.ledger.setChannelStatus(channelId, "ingesting");
    await deps.ledger.clearChannelError(channelId);
    log.info(`[${channelId}] ingestão iniciada: "${title}"`);
    let currentPhase: PhaseKey = phases[0]?.key ?? "videos";
    try {
      // The Ingestion sequence is driven by the Phase registry (#20): the
      // order lives in `phases`, and each Phase's `run` is invoked in turn.
      for (const phase of phases) {
        currentPhase = phase.key;
        await phase.run(channelId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const cause = err instanceof Error ? err : undefined;
      await deps.ledger.setChannelStatus(channelId, "failed");
      await deps.ledger.updatePhase(channelId, currentPhase, { status: "failed" });
      await deps.ledger.setChannelError(channelId, message);
      log.error(`[${channelId}] fase "${currentPhase}" falhou: ${message}`, cause);
      throw err;
    }
    await deps.ledger.setChannelStatus(channelId, "completed");
    log.info(`[${channelId}] ingestão concluída`);
  }

  /**
   * Private test seam — NOT part of the public `Ingestion` interface. The
   * leading `_` signals that this method exists only so the module's own
   * tests can drive a single Fase in isolation (per the codebase-design
   * principle: internal seams stay testable while the public interface stays
   * narrow). Production callers use `runJob`. It is returned from
   * `createIngestion` (so tests reach it via the inferred return type) but is
   * absent from the exported `Ingestion` type.
   */
  async function _runPhase(phase: PhaseKey, channelId: string): Promise<void> {
    const phaseEntry = phases.find((p) => p.key === phase);
    if (!phaseEntry) {
      throw new Error(`fase desconhecida: ${phase}`);
    }
    await phaseEntry.run(channelId);
  }

  return { runJob, _runPhase };
}