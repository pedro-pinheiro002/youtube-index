import type { DatabaseSync } from "node:sqlite";
import type { Job } from "./types.js";

const RECOVERY_THRESHOLD_MS = 5 * 60 * 1000;

export interface IngestionQueue {
  enqueue(channelId: string): Job;
  claimNext(): Job | null;
  complete(jobId: number): void;
  fail(jobId: number): void;
  listJobs(channelId: string): Job[];
}

interface JobRow {
  id: number;
  channel_id: string;
  status: Job["status"];
  created_at: string;
}

export class SqliteIngestionQueue implements IngestionQueue {
  private readonly db: DatabaseSync;
  private readonly now: () => Date;

  constructor(db: DatabaseSync, now: () => Date = () => new Date()) {
    this.db = db;
    this.now = now;
  }

  enqueue(channelId: string): Job {
    const createdAt = this.now().toISOString();
    const result = this.db
      .prepare("INSERT INTO ingestion_jobs (channel_id, status, created_at) VALUES (?, 'queued', ?)")
      .run(channelId, createdAt);
    const id = Number(result.lastInsertRowid);
    return { id, channelId, status: "queued", createdAt };
  }

  claimNext(): Job | null {
    const cutoff = new Date(this.now().getTime() - RECOVERY_THRESHOLD_MS).toISOString();
    this.db
      .prepare("UPDATE ingestion_jobs SET status = 'queued' WHERE status = 'running' AND created_at < ?")
      .run(cutoff);

    const row = this.db
      .prepare(
        "SELECT id, channel_id, status, created_at FROM ingestion_jobs WHERE status = 'queued' ORDER BY id LIMIT 1",
      )
      .get() as unknown as JobRow | undefined;
    if (!row) {
      return null;
    }
    this.db.prepare("UPDATE ingestion_jobs SET status = 'running' WHERE id = ?").run(row.id);
    return { id: row.id, channelId: row.channel_id, status: "running", createdAt: row.created_at };
  }

  complete(jobId: number): void {
    this.db.prepare("UPDATE ingestion_jobs SET status = 'completed' WHERE id = ?").run(jobId);
  }

  fail(jobId: number): void {
    this.db.prepare("UPDATE ingestion_jobs SET status = 'failed' WHERE id = ?").run(jobId);
  }

  listJobs(channelId: string): Job[] {
    const rows = this.db
      .prepare("SELECT id, channel_id, status, created_at FROM ingestion_jobs WHERE channel_id = ? ORDER BY id")
      .all(channelId) as unknown as JobRow[];
    return rows.map((row) => ({
      id: row.id,
      channelId: row.channel_id,
      status: row.status,
      createdAt: row.created_at,
    }));
  }
}
