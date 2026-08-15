import type { DatabaseSync } from "node:sqlite";
import type { ChannelWithPhases, Job, PhaseKey, PhaseStatus } from "./types.js";
import { PHASES } from "./types.js";

export interface CreateChannelInput {
  channelId: string;
  handle: string;
  title: string;
}

export interface Ledger {
  createChannel(input: CreateChannelInput): ChannelWithPhases;
  getChannel(channelId: string): ChannelWithPhases | null;
  enqueueJob(channelId: string): Job;
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

  enqueueJob(channelId: string): Job {
    const now = new Date().toISOString();
    const result = this.db
      .prepare("INSERT INTO ingestion_jobs (channel_id, status, created_at) VALUES (?, 'queued', ?)")
      .run(channelId, now);
    const id = Number(result.lastInsertRowid);
    return { id, channelId, status: "queued", createdAt: now };
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