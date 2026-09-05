import type pg from "pg";
import type { ChannelStatus, ChannelWithPhases, PhaseKey, PhaseProgress } from "./types.js";
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
  status: PhaseProgress["status"];
  done: number;
  total: number | null;
}

interface VideoRow {
  id: string;
  channel_id: string;
  title: string;
  description: string;
  published_at: string;
  views: number;
  likes: number;
  duration_seconds: number;
}

interface CommentRow {
  id: string;
  video_id: string;
  channel_id: string;
  author: string;
  text: string;
  likes: number;
  published_at: string;
}

interface TranscriptSegmentRow {
  video_id: string;
  channel_id: string;
  start_seconds: number;
  end_seconds: number;
  text: string;
}

interface AbsenceRow {
  video_id: string;
  reason?: string;
}

/**
 * Implementação Postgres do Ledger. Espelha `SqliteLedger` na superfície
 * — mesmos métodos, mesma semântica de idempotência e ordenação —
 * escrevendo contra um `pg.Pool` parametrizado. Cada operação é uma
 * transação implícita por query (Postgres auto-commita cada statement
 * fora de BEGIN/COMMIT explícito), e os métodos que precisam de
 * múltiplas operações (`createChannel`, `updatePhase` parcial) usam
 * `client.query("BEGIN")` / `COMMIT` via `pool.connect()`.
 */
export class PostgresLedger implements Ledger {
  constructor(private readonly pool: pg.Pool) {}

  async createChannel(input: CreateChannelInput): Promise<ChannelWithPhases> {
    const now = new Date().toISOString();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO channels (id, handle, title, status, last_error, created_at)
         VALUES ($1, $2, $3, 'queued', NULL, $4)
         ON CONFLICT (id) DO UPDATE SET
           handle = EXCLUDED.handle,
           title = EXCLUDED.title,
           status = 'queued',
           last_error = NULL`,
        [input.channelId, input.handle, input.title, now],
      );

      for (const phase of PHASES) {
        await client.query(
          `INSERT INTO channel_phases (channel_id, phase, status, done, total)
           VALUES ($1, $2, 'pending', 0, NULL)
           ON CONFLICT (channel_id, phase) DO NOTHING`,
          [input.channelId, phase.key],
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    const channel = await this.getChannel(input.channelId);
    if (!channel) {
      throw new Error("channel creation failed");
    }
    return channel;
  }

  async getChannel(channelId: string): Promise<ChannelWithPhases | null> {
    const channelRow = (await this.pool
      .query(
        `SELECT id, handle, title, status, last_error, created_at
         FROM channels WHERE id = $1`,
        [channelId],
      )
      .then((res) => res.rows[0])) as ChannelRow | undefined;
    if (!channelRow) {
      return null;
    }

    const phaseRows = (await this.pool.query(
      `SELECT phase, status, done, total FROM channel_phases WHERE channel_id = $1`,
      [channelId],
    ).then((res) => res.rows)) as PhaseRow[];

    const phases = {} as ChannelWithPhases["phases"];
    for (const phase of PHASES) {
      const row = phaseRows.find((p) => p.phase === phase.key);
      phases[phase.key] = {
        phase: phase.key,
        status: row?.status ?? "pending",
        done: row?.done ?? 0,
        total: row?.total ?? null,
      };
    }

    return {
      id: channelRow.id,
      handle: channelRow.handle,
      title: channelRow.title,
      status: channelRow.status,
      lastError: channelRow.last_error,
      createdAt: channelRow.created_at,
      phases,
    };
  }

  async listChannels(): Promise<ChannelWithPhases[]> {
    const channelRows = (await this.pool
      .query(`SELECT id FROM channels ORDER BY created_at DESC`)
      .then((res) => res.rows)) as Array<{ id: string }>;
    const channels: ChannelWithPhases[] = [];
    for (const row of channelRows) {
      const channel = await this.getChannel(row.id);
      if (channel) {
        channels.push(channel);
      }
    }
    return channels;
  }

  async setChannelStatus(channelId: string, status: ChannelStatus): Promise<void> {
    await this.pool.query(`UPDATE channels SET status = $1 WHERE id = $2`, [status, channelId]);
  }

  async setChannelError(channelId: string, message: string): Promise<void> {
    await this.pool.query(`UPDATE channels SET last_error = $1 WHERE id = $2`, [message, channelId]);
  }

  async clearChannelError(channelId: string): Promise<void> {
    await this.pool.query(`UPDATE channels SET last_error = NULL WHERE id = $1`, [channelId]);
  }

  async deleteChannel(channelId: string): Promise<void> {
    // Cascade apaga channel_phases, ingestion_jobs, videos, comments,
    // transcript_segments, transcript_absences e comment_absences.
    await this.pool.query(`DELETE FROM channels WHERE id = $1`, [channelId]);
  }

  async updatePhase(
    channelId: string,
    phase: PhaseKey,
    update: Partial<Pick<PhaseProgress, "status" | "done" | "total">>,
  ): Promise<void> {
    const sets: string[] = [];
    const values: Array<string | number | null> = [];
    if (update.status !== undefined) {
      sets.push(`status = $${sets.length + 1}`);
      values.push(update.status);
    }
    if (update.done !== undefined) {
      sets.push(`done = $${sets.length + 1}`);
      values.push(update.done);
    }
    if (update.total !== undefined) {
      sets.push(`total = $${sets.length + 1}`);
      values.push(update.total);
    }
    if (sets.length === 0) {
      return;
    }
    values.push(channelId, phase);
    await this.pool.query(
      `UPDATE channel_phases SET ${sets.join(", ")} WHERE channel_id = $${sets.length + 1} AND phase = $${sets.length + 2}`,
      values,
    );
  }

  async upsertVideo(video: VideoRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO videos (id, channel_id, title, description, published_at, views, likes, duration_seconds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        video.id,
        video.channelId,
        video.title,
        video.description,
        video.publishedAt,
        video.views,
        video.likes,
        video.durationSeconds,
      ],
    );
  }

  async hasVideo(videoId: string): Promise<boolean> {
    const res = await this.pool.query(`SELECT 1 FROM videos WHERE id = $1 LIMIT 1`, [videoId]);
    return (res.rowCount ?? 0) > 0;
  }

  async videoContext(videoId: string): Promise<VideoContext | null> {
    const row = (await this.pool
      .query(
        `SELECT id, title, views, likes, published_at FROM videos WHERE id = $1`,
        [videoId],
      )
      .then((res) => res.rows[0])) as
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
    const rows = (await this.pool.query(
      `SELECT id, channel_id, title, description, published_at, views, likes, duration_seconds
       FROM videos WHERE channel_id = $1
       ORDER BY published_at DESC`,
      [channelId],
    ).then((res) => res.rows)) as VideoRow[];
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
    await this.pool.query(
      `INSERT INTO comments (id, video_id, author, text, likes, published_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [comment.id, comment.videoId, comment.author, comment.text, comment.likes, comment.publishedAt],
    );
  }

  async deleteCommentsForVideo(videoId: string): Promise<void> {
    await this.pool.query(`DELETE FROM comments WHERE video_id = $1`, [videoId]);
  }

  async hasCommentIngestion(videoId: string): Promise<boolean> {
    // Duas queries separadas evita o requisito de parênteses nos
    // operandos do UNION (cada `SELECT … LIMIT 1` precisa do próprio
    // escopo) e mantém o plano simples para cada índice.
    const [hasComment, hasAbsence] = await Promise.all([
      this.pool.query(`SELECT 1 FROM comments WHERE video_id = $1 LIMIT 1`, [videoId]),
      this.pool.query(`SELECT 1 FROM comment_absences WHERE video_id = $1 LIMIT 1`, [videoId]),
    ]);
    return ((hasComment.rowCount ?? 0) + (hasAbsence.rowCount ?? 0)) > 0;
  }

  async markCommentAbsence(videoId: string, reason: CommentAbsenceReason): Promise<void> {
    await this.pool.query(
      `INSERT INTO comment_absences (video_id, reason)
       VALUES ($1, $2)
       ON CONFLICT (video_id) DO UPDATE SET reason = EXCLUDED.reason`,
      [videoId, reason],
    );
  }

  async clearCommentAbsence(videoId: string): Promise<void> {
    await this.pool.query(`DELETE FROM comment_absences WHERE video_id = $1`, [videoId]);
  }

  async listCommentAbsences(channelId: string): Promise<string[]> {
    const rows = (await this.pool.query(
      `SELECT a.video_id FROM comment_absences a
       JOIN videos v ON v.id = a.video_id
       WHERE v.channel_id = $1
       ORDER BY a.video_id`,
      [channelId],
    ).then((res) => res.rows)) as AbsenceRow[];
    return rows.map((row) => row.video_id);
  }

  async listComments(channelId: string): Promise<CommentRecord[]> {
    const rows = (await this.pool.query(
      `SELECT c.id, c.video_id, v.channel_id, c.author, c.text, c.likes, c.published_at
       FROM comments c JOIN videos v ON v.id = c.video_id
       WHERE v.channel_id = $1
       ORDER BY c.published_at DESC`,
      [channelId],
    ).then((res) => res.rows)) as CommentRow[];
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
    await this.pool.query(
      `INSERT INTO transcript_segments (video_id, start_seconds, end_seconds, text)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (video_id, start_seconds) DO NOTHING`,
      [segment.videoId, segment.start, segment.end, segment.text],
    );
  }

  async hasTranscriptIngestion(videoId: string): Promise<boolean> {
    // Veja `hasCommentIngestion` — duas queries em paralelo.
    const [hasSegment, hasAbsence] = await Promise.all([
      this.pool.query(`SELECT 1 FROM transcript_segments WHERE video_id = $1 LIMIT 1`, [videoId]),
      this.pool.query(`SELECT 1 FROM transcript_absences WHERE video_id = $1 LIMIT 1`, [videoId]),
    ]);
    return ((hasSegment.rowCount ?? 0) + (hasAbsence.rowCount ?? 0)) > 0;
  }

  async listTranscriptSegments(channelId: string): Promise<TranscriptSegmentRecord[]> {
    const rows = (await this.pool.query(
      `SELECT t.video_id, t.start_seconds, t.end_seconds, t.text, v.channel_id
       FROM transcript_segments t JOIN videos v ON v.id = t.video_id
       WHERE v.channel_id = $1
       ORDER BY t.start_seconds`,
      [channelId],
    ).then((res) => res.rows)) as TranscriptSegmentRow[];
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
    await this.pool.query(
      `INSERT INTO transcript_absences (video_id)
       VALUES ($1)
       ON CONFLICT (video_id) DO NOTHING`,
      [videoId],
    );
  }

  async listTranscriptAbsences(channelId: string): Promise<string[]> {
    const rows = (await this.pool.query(
      `SELECT a.video_id FROM transcript_absences a
       JOIN videos v ON v.id = a.video_id
       WHERE v.channel_id = $1
       ORDER BY a.video_id`,
      [channelId],
    ).then((res) => res.rows)) as AbsenceRow[];
    return rows.map((row) => row.video_id);
  }

  async deleteTranscriptSegmentsForVideo(videoId: string): Promise<void> {
    await this.pool.query(`DELETE FROM transcript_segments WHERE video_id = $1`, [videoId]);
  }
}