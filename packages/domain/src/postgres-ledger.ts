import type pg from "pg";
import type { ChannelStatus, ChannelWithPhases, PhaseKey, PhaseProgress } from "./types.js";
import { PHASES } from "./phases.js";
import type {
  CommentAbsenceReason,
  CommentRecord,
  CreateChannelInput,
  Ledger,
  TranscriptSegmentRecord,
  VideoContext,
  VideoRecord,
} from "./ledger.js";
import { NotImplementedError } from "./postgres-schema.js";

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

/**
 * Implementação Postgres do Ledger para o slice "channel lifecycle".
 * Os métodos de Canal (createChannel, getChannel, listChannels,
 * setChannelStatus, setChannelError, clearChannelError, updatePhase) já
 * escrevem e leem do Postgres; os demais métodos da interface Ledger
 * lançam `NotImplementedError` e serão preenchidos nos próximos slices
 * (issue #43 cobre o Ledger completo de Vídeos/Comentários/Segmentos).
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
    // O cascade do schema apaga channel_phases e ingestion_jobs. videos
    // e derivados só existem a partir de #43.
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

  // ---------------------------------------------------------------------------
  // Métodos fora do escopo deste slice (issue #42). Serão preenchidos em #43+.
  // ---------------------------------------------------------------------------

  async upsertVideo(_video: VideoRecord): Promise<void> {
    throw new NotImplementedError("upsertVideo", "PostgresLedger", "#43");
  }
  async hasVideo(_videoId: string): Promise<boolean> {
    throw new NotImplementedError("hasVideo", "PostgresLedger", "#43");
  }
  async videoContext(_videoId: string): Promise<VideoContext | null> {
    throw new NotImplementedError("videoContext", "PostgresLedger", "#43");
  }
  async listVideos(_channelId: string): Promise<VideoRecord[]> {
    throw new NotImplementedError("listVideos", "PostgresLedger", "#43");
  }
  async upsertComment(_comment: CommentRecord): Promise<void> {
    throw new NotImplementedError("upsertComment", "PostgresLedger", "#43");
  }
  async deleteCommentsForVideo(_videoId: string): Promise<void> {
    throw new NotImplementedError("deleteCommentsForVideo", "PostgresLedger", "#43");
  }
  async hasCommentIngestion(_videoId: string): Promise<boolean> {
    throw new NotImplementedError("hasCommentIngestion", "PostgresLedger", "#43");
  }
  async markCommentAbsence(_videoId: string, _reason: CommentAbsenceReason): Promise<void> {
    throw new NotImplementedError("markCommentAbsence", "PostgresLedger", "#43");
  }
  async clearCommentAbsence(_videoId: string): Promise<void> {
    throw new NotImplementedError("clearCommentAbsence", "PostgresLedger", "#43");
  }
  async listCommentAbsences(_channelId: string): Promise<string[]> {
    throw new NotImplementedError("listCommentAbsences", "PostgresLedger", "#43");
  }
  async listComments(_channelId: string): Promise<CommentRecord[]> {
    throw new NotImplementedError("listComments", "PostgresLedger", "#43");
  }
  async upsertTranscriptSegment(_segment: TranscriptSegmentRecord): Promise<void> {
    throw new NotImplementedError("upsertTranscriptSegment", "PostgresLedger", "#43");
  }
  async hasTranscriptIngestion(_videoId: string): Promise<boolean> {
    throw new NotImplementedError("hasTranscriptIngestion", "PostgresLedger", "#43");
  }
  async listTranscriptSegments(_channelId: string): Promise<TranscriptSegmentRecord[]> {
    throw new NotImplementedError("listTranscriptSegments", "PostgresLedger", "#43");
  }
  async markTranscriptAbsent(_videoId: string): Promise<void> {
    throw new NotImplementedError("markTranscriptAbsent", "PostgresLedger", "#43");
  }
  async listTranscriptAbsences(_channelId: string): Promise<string[]> {
    throw new NotImplementedError("listTranscriptAbsences", "PostgresLedger", "#43");
  }
  async deleteTranscriptSegmentsForVideo(_videoId: string): Promise<void> {
    throw new NotImplementedError("deleteTranscriptSegmentsForVideo", "PostgresLedger", "#43");
  }
}