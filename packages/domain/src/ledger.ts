import type { DatabaseSync } from "node:sqlite";
import type { ChannelStatus, ChannelWithPhases, PhaseKey, PhaseProgress, PhaseStatus } from "./types.js";
import { PHASES } from "./phases.js";

export interface CreateChannelInput {
  channelId: string;
  handle: string;
  title: string;
}

export interface VideoRecord {
  id: string;
  channelId: string;
  title: string;
  description: string;
  publishedAt: string;
  views: number;
  likes: number;
  durationSeconds: number;
}

/** O contexto canônico de um Vídeo usado para compor Documentos de Comentário e Segmento. */
export interface VideoContext {
  id: string;
  title: string;
  views: number;
  likes: number;
  publishedAt: string;
}

export interface CommentRecord {
  id: string;
  videoId: string;
  channelId: string;
  author: string;
  text: string;
  likes: number;
  publishedAt: string;
}

export interface TranscriptSegmentRecord {
  id: string;
  videoId: string;
  channelId: string;
  start: number;
  end: number;
  text: string;
}

export type CommentAbsenceReason = "disabled" | "none";

export interface Ledger {
  createChannel(input: CreateChannelInput): Promise<ChannelWithPhases>;
  getChannel(channelId: string): Promise<ChannelWithPhases | null>;
  listChannels(): Promise<ChannelWithPhases[]>;
  setChannelStatus(channelId: string, status: ChannelStatus): Promise<void>;
  setChannelError(channelId: string, message: string): Promise<void>;
  clearChannelError(channelId: string): Promise<void>;
  updatePhase(
    channelId: string,
    phase: PhaseKey,
    update: Partial<Pick<PhaseProgress, "status" | "done" | "total">>,
  ): Promise<void>;
  /**
   * Apaga o Canal e, por cascade do schema (channel_phases, ingestion_jobs,
   * e futuramente videos → comments/segments), todos os dados ligados a ele.
   * Slice #43 amplia o cascade para cobrir os Documentos em Postgres.
   */
  deleteChannel(channelId: string): Promise<void>;
  upsertVideo(video: VideoRecord): Promise<void>;
  hasVideo(videoId: string): Promise<boolean>;
  videoContext(videoId: string): Promise<VideoContext | null>;
  listVideos(channelId: string): Promise<VideoRecord[]>;
  upsertComment(comment: CommentRecord): Promise<void>;
  deleteCommentsForVideo(videoId: string): Promise<void>;
  hasCommentIngestion(videoId: string): Promise<boolean>;
  markCommentAbsence(videoId: string, reason: CommentAbsenceReason): Promise<void>;
  clearCommentAbsence(videoId: string): Promise<void>;
  listCommentAbsences(channelId: string): Promise<string[]>;
  listComments(channelId: string): Promise<CommentRecord[]>;
  upsertTranscriptSegment(segment: TranscriptSegmentRecord): Promise<void>;
  hasTranscriptIngestion(videoId: string): Promise<boolean>;
  listTranscriptSegments(channelId: string): Promise<TranscriptSegmentRecord[]>;
  markTranscriptAbsent(videoId: string): Promise<void>;
  listTranscriptAbsences(channelId: string): Promise<string[]>;
  /**
   * Apaga todos os Segmentos de Transcrição do Vídeo no Ledger. Usado
   * quando a Transcrição mudou e o Worker precisa re-projetar os
   * Segmentos do zero — sem isso, Segmentos stale permaneceriam no
   * Ledger (e, depois de re-projetar, no Índice).
   */
  deleteTranscriptSegmentsForVideo(videoId: string): Promise<void>;
}

interface ChannelRow {
  id: string;
  handle: string;
  title: string;
  status: ChannelWithPhases["status"];
  last_error: string | null;
  created_at: string;
}

interface PhaseRow {
  phase: PhaseKey;
  status: PhaseStatus;
  done: number;
  total: number | null;
}

export class SqliteLedger implements Ledger {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  private hasRow(table: string, videoId: string): boolean {
    const row = this.db.prepare(`SELECT 1 FROM ${table} WHERE video_id = ? LIMIT 1`).get(videoId);
    return row !== undefined;
  }

  async createChannel(input: CreateChannelInput): Promise<ChannelWithPhases> {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO channels (id, handle, title, status, last_error, created_at) VALUES (?, ?, ?, 'queued', NULL, ?) " +
          "ON CONFLICT(id) DO UPDATE SET handle = excluded.handle, title = excluded.title, status = 'queued', last_error = NULL",
      )
      .run(input.channelId, input.handle, input.title, now);

    const insertPhase = this.db.prepare(
      "INSERT INTO channel_phases (channel_id, phase, status, done, total) VALUES (?, ?, 'pending', 0, NULL) " +
        "ON CONFLICT(channel_id, phase) DO NOTHING",
    );
    for (const phase of PHASES.map((p) => p.key)) {
      insertPhase.run(input.channelId, phase);
    }

    const channel = await this.getChannel(input.channelId);
    if (!channel) {
      throw new Error("channel creation failed");
    }
    return channel;
  }

  async getChannel(channelId: string): Promise<ChannelWithPhases | null> {
    const row = this.db
      .prepare("SELECT id, handle, title, status, last_error, created_at FROM channels WHERE id = ?")
      .get(channelId) as unknown as ChannelRow | undefined;
    if (!row) {
      return null;
    }

    const phaseRows = this.db
      .prepare("SELECT phase, status, done, total FROM channel_phases WHERE channel_id = ?")
      .all(channelId) as unknown as PhaseRow[];

    const phases = {} as ChannelWithPhases["phases"];
    for (const phase of PHASES.map((p) => p.key)) {
      const phaseRow = phaseRows.find((p) => p.phase === phase);
      phases[phase] = {
        phase,
        status: phaseRow?.status ?? "pending",
        done: phaseRow?.done ?? 0,
        total: phaseRow?.total ?? null,
      };
    }

    return {
      id: row.id,
      handle: row.handle,
      title: row.title,
      status: row.status,
      lastError: row.last_error,
      createdAt: row.created_at,
      phases,
    };
  }

  async listChannels(): Promise<ChannelWithPhases[]> {
    const rows = this.db
      .prepare("SELECT id FROM channels ORDER BY created_at DESC")
      .all() as unknown as Array<{ id: string }>;
    const channels: ChannelWithPhases[] = [];
    for (const row of rows) {
      const channel = await this.getChannel(row.id);
      if (channel) {
        channels.push(channel);
      }
    }
    return channels;
  }

  async setChannelStatus(channelId: string, status: ChannelStatus): Promise<void> {
    this.db.prepare("UPDATE channels SET status = ? WHERE id = ?").run(status, channelId);
  }

  async setChannelError(channelId: string, message: string): Promise<void> {
    this.db.prepare("UPDATE channels SET last_error = ? WHERE id = ?").run(message, channelId);
  }

  async clearChannelError(channelId: string): Promise<void> {
    this.db.prepare("UPDATE channels SET last_error = NULL WHERE id = ?").run(channelId);
  }

  async deleteChannel(channelId: string): Promise<void> {
    this.db.prepare("DELETE FROM channels WHERE id = ?").run(channelId);
  }

  async updatePhase(
    channelId: string,
    phase: PhaseKey,
    update: Partial<Pick<PhaseProgress, "status" | "done" | "total">>,
  ): Promise<void> {
    const sets: string[] = [];
    const values: Array<string | number | null> = [];
    if (update.status !== undefined) {
      sets.push("status = ?");
      values.push(update.status);
    }
    if (update.done !== undefined) {
      sets.push("done = ?");
      values.push(update.done);
    }
    if (update.total !== undefined) {
      sets.push("total = ?");
      values.push(update.total);
    }
    if (sets.length === 0) {
      return;
    }
    values.push(channelId, phase);
    this.db
      .prepare(`UPDATE channel_phases SET ${sets.join(", ")} WHERE channel_id = ? AND phase = ?`)
      .run(...values);
  }

  async upsertVideo(video: VideoRecord): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO videos (id, channel_id, title, description, published_at, views, likes, duration_seconds, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
      )
      .run(
        video.id,
        video.channelId,
        video.title,
        video.description,
        video.publishedAt,
        video.views,
        video.likes,
        video.durationSeconds,
        now,
      );
  }

  async hasVideo(videoId: string): Promise<boolean> {
    const row = this.db.prepare("SELECT 1 FROM videos WHERE id = ? LIMIT 1").get(videoId);
    return row !== undefined;
  }

  async videoContext(videoId: string): Promise<VideoContext | null> {
    const row = this.db
      .prepare("SELECT id, title, views, likes, published_at FROM videos WHERE id = ?")
      .get(videoId) as unknown as
      | { id: string; title: string; views: number; likes: number; published_at: string }
      | undefined;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      title: row.title,
      views: row.views,
      likes: row.likes,
      publishedAt: row.published_at,
    };
  }

  async listVideos(channelId: string): Promise<VideoRecord[]> {
    const rows = this.db
      .prepare(
        "SELECT id, channel_id, title, description, published_at, views, likes, duration_seconds " +
          "FROM videos WHERE channel_id = ? ORDER BY published_at DESC",
      )
      .all(channelId) as unknown as Array<{
      id: string;
      channel_id: string;
      title: string;
      description: string;
      published_at: string;
      views: number;
      likes: number;
      duration_seconds: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      channelId: row.channel_id,
      title: row.title,
      description: row.description,
      publishedAt: row.published_at,
      views: row.views,
      likes: row.likes,
      durationSeconds: row.duration_seconds,
    }));
  }

  async upsertComment(comment: CommentRecord): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO comments (id, video_id, author, text, likes, published_at, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
      )
      .run(comment.id, comment.videoId, comment.author, comment.text, comment.likes, comment.publishedAt, now);
  }

  async deleteCommentsForVideo(videoId: string): Promise<void> {
    this.db.prepare("DELETE FROM comments WHERE video_id = ?").run(videoId);
  }

  async hasCommentIngestion(videoId: string): Promise<boolean> {
    return this.hasRow("comments", videoId) || this.hasRow("comment_absences", videoId);
  }

  async markCommentAbsence(videoId: string, reason: CommentAbsenceReason): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO comment_absences (video_id, reason, created_at) VALUES (?, ?, ?) " +
          "ON CONFLICT(video_id) DO UPDATE SET reason = excluded.reason",
      )
      .run(videoId, reason, now);
  }

  async clearCommentAbsence(videoId: string): Promise<void> {
    this.db.prepare("DELETE FROM comment_absences WHERE video_id = ?").run(videoId);
  }

  async listCommentAbsences(channelId: string): Promise<string[]> {
    const rows = this.db
      .prepare(
        "SELECT a.video_id FROM comment_absences a JOIN videos v ON v.id = a.video_id " +
          "WHERE v.channel_id = ? ORDER BY a.video_id",
      )
      .all(channelId) as unknown as Array<{ video_id: string }>;
    return rows.map((row) => row.video_id);
  }

  async listComments(channelId: string): Promise<CommentRecord[]> {
    const rows = this.db
      .prepare(
        "SELECT c.id, c.video_id, v.channel_id, c.author, c.text, c.likes, c.published_at " +
          "FROM comments c JOIN videos v ON v.id = c.video_id " +
          "WHERE v.channel_id = ? ORDER BY c.published_at DESC",
      )
      .all(channelId) as unknown as Array<{
      id: string;
      video_id: string;
      channel_id: string;
      author: string;
      text: string;
      likes: number;
      published_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      videoId: row.video_id,
      channelId: row.channel_id,
      author: row.author,
      text: row.text,
      likes: row.likes,
      publishedAt: row.published_at,
    }));
  }

  async upsertTranscriptSegment(segment: TranscriptSegmentRecord): Promise<void> {
    this.db
      .prepare(
        "INSERT INTO transcript_segments (video_id, start_seconds, end_seconds, text) " +
          "VALUES (?, ?, ?, ?) ON CONFLICT(video_id, start_seconds) DO NOTHING",
      )
      .run(segment.videoId, segment.start, segment.end, segment.text);
  }

  async hasTranscriptIngestion(videoId: string): Promise<boolean> {
    return this.hasRow("transcript_segments", videoId) || this.hasRow("transcript_absences", videoId);
  }

  async listTranscriptSegments(channelId: string): Promise<TranscriptSegmentRecord[]> {
    const rows = this.db
      .prepare(
        "SELECT t.video_id, t.start_seconds, t.end_seconds, t.text, v.channel_id " +
          "FROM transcript_segments t JOIN videos v ON v.id = t.video_id " +
          "WHERE v.channel_id = ? ORDER BY t.start_seconds",
      )
      .all(channelId) as unknown as Array<{
      video_id: string;
      start_seconds: number;
      end_seconds: number;
      text: string;
      channel_id: string;
    }>;
    return rows.map((row) => ({
      id: `${row.video_id}:${row.start_seconds}`,
      videoId: row.video_id,
      channelId: row.channel_id,
      start: row.start_seconds,
      end: row.end_seconds,
      text: row.text,
    }));
  }

  async markTranscriptAbsent(videoId: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare("INSERT INTO transcript_absences (video_id, created_at) VALUES (?, ?) ON CONFLICT(video_id) DO NOTHING")
      .run(videoId, now);
  }

  async deleteTranscriptSegmentsForVideo(videoId: string): Promise<void> {
    this.db.prepare("DELETE FROM transcript_segments WHERE video_id = ?").run(videoId);
  }

  async listTranscriptAbsences(channelId: string): Promise<string[]> {
    const rows = this.db
      .prepare(
        "SELECT a.video_id FROM transcript_absences a JOIN videos v ON v.id = a.video_id " +
          "WHERE v.channel_id = ? ORDER BY a.video_id",
      )
      .all(channelId) as unknown as Array<{ video_id: string }>;
    return rows.map((row) => row.video_id);
  }
}