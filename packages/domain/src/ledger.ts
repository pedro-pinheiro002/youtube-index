import type { DatabaseSync } from "node:sqlite";
import type { ChannelStatus, ChannelWithPhases, Job, PhaseKey, PhaseProgress, PhaseStatus } from "./types.js";
import { PHASES } from "./types.js";

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

export interface CommentRecord {
  id: string;
  videoId: string;
  channelId: string;
  videoTitle: string;
  author: string;
  text: string;
  likes: number;
  publishedAt: string;
}

export interface Ledger {
  createChannel(input: CreateChannelInput): ChannelWithPhases;
  getChannel(channelId: string): ChannelWithPhases | null;
  setChannelStatus(channelId: string, status: ChannelStatus): void;
  updatePhase(channelId: string, phase: PhaseKey, update: Partial<Pick<PhaseProgress, "status" | "done" | "total">>): void;
  upsertVideo(video: VideoRecord): void;
  listVideos(channelId: string): VideoRecord[];
  upsertComment(comment: CommentRecord): void;
  listComments(channelId: string): CommentRecord[];
  enqueueJob(channelId: string): Job;
  claimNextJob(): Job | null;
  completeJob(jobId: number): void;
  failJob(jobId: number): void;
  listJobs(channelId: string): Job[];
}

interface ChannelRow {
  id: string;
  handle: string;
  title: string;
  status: ChannelWithPhases["status"];
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

  createChannel(input: CreateChannelInput): ChannelWithPhases {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO channels (id, handle, title, status, created_at) VALUES (?, ?, ?, 'queued', ?) " +
          "ON CONFLICT(id) DO UPDATE SET handle = excluded.handle, title = excluded.title, status = 'queued'",
      )
      .run(input.channelId, input.handle, input.title, now);

    const insertPhase = this.db.prepare(
      "INSERT INTO channel_phases (channel_id, phase, status, done, total) VALUES (?, ?, 'pending', 0, NULL) " +
        "ON CONFLICT(channel_id, phase) DO NOTHING",
    );
    for (const phase of PHASES) {
      insertPhase.run(input.channelId, phase);
    }

    const channel = this.getChannel(input.channelId);
    if (!channel) {
      throw new Error("channel creation failed");
    }
    return channel;
  }

  getChannel(channelId: string): ChannelWithPhases | null {
    const row = this.db
      .prepare("SELECT id, handle, title, status, created_at FROM channels WHERE id = ?")
      .get(channelId) as unknown as ChannelRow | undefined;
    if (!row) {
      return null;
    }

    const phaseRows = this.db
      .prepare("SELECT phase, status, done, total FROM channel_phases WHERE channel_id = ?")
      .all(channelId) as unknown as PhaseRow[];

    const phases = {} as ChannelWithPhases["phases"];
    for (const phase of PHASES) {
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
      createdAt: row.created_at,
      phases,
    };
  }

  setChannelStatus(channelId: string, status: ChannelStatus): void {
    this.db.prepare("UPDATE channels SET status = ? WHERE id = ?").run(status, channelId);
  }

  updatePhase(channelId: string, phase: PhaseKey, update: Partial<Pick<PhaseProgress, "status" | "done" | "total">>): void {
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

  upsertVideo(video: VideoRecord): void {
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

  listVideos(channelId: string): VideoRecord[] {
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

  upsertComment(comment: CommentRecord): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO comments (id, video_id, author, text, likes, published_at, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
      )
      .run(comment.id, comment.videoId, comment.author, comment.text, comment.likes, comment.publishedAt, now);
  }

  listComments(channelId: string): CommentRecord[] {
    const rows = this.db
      .prepare(
        "SELECT c.id, c.video_id, v.channel_id, v.title AS video_title, c.author, c.text, c.likes, c.published_at " +
          "FROM comments c JOIN videos v ON v.id = c.video_id " +
          "WHERE v.channel_id = ? ORDER BY c.published_at DESC",
      )
      .all(channelId) as unknown as Array<{
      id: string;
      video_id: string;
      channel_id: string;
      video_title: string;
      author: string;
      text: string;
      likes: number;
      published_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      videoId: row.video_id,
      channelId: row.channel_id,
      videoTitle: row.video_title,
      author: row.author,
      text: row.text,
      likes: row.likes,
      publishedAt: row.published_at,
    }));
  }

  enqueueJob(channelId: string): Job {
    const now = new Date().toISOString();
    const result = this.db
      .prepare("INSERT INTO ingestion_jobs (channel_id, status, created_at) VALUES (?, 'queued', ?)")
      .run(channelId, now);
    const id = Number(result.lastInsertRowid);
    return { id, channelId, status: "queued", createdAt: now };
  }

  claimNextJob(): Job | null {
    const row = this.db
      .prepare(
        "SELECT id, channel_id, status, created_at FROM ingestion_jobs WHERE status = 'queued' ORDER BY id LIMIT 1",
      )
      .get() as unknown as
      | {
          id: number;
          channel_id: string;
          status: Job["status"];
          created_at: string;
        }
      | undefined;
    if (!row) {
      return null;
    }
    this.db.prepare("UPDATE ingestion_jobs SET status = 'running' WHERE id = ?").run(row.id);
    return { id: row.id, channelId: row.channel_id, status: "running", createdAt: row.created_at };
  }

  completeJob(jobId: number): void {
    this.db.prepare("UPDATE ingestion_jobs SET status = 'completed' WHERE id = ?").run(jobId);
  }

  failJob(jobId: number): void {
    this.db.prepare("UPDATE ingestion_jobs SET status = 'failed' WHERE id = ?").run(jobId);
  }

  listJobs(channelId: string): Job[] {
    const rows = this.db
      .prepare("SELECT id, channel_id, status, created_at FROM ingestion_jobs WHERE channel_id = ? ORDER BY id")
      .all(channelId) as unknown as Array<{
      id: number;
      channel_id: string;
      status: Job["status"];
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      channelId: row.channel_id,
      status: row.status,
      createdAt: row.created_at,
    }));
  }
}