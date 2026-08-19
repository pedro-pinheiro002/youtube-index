export type ChannelStatus = "queued" | "ingesting" | "completed" | "failed";

export type PhaseKey = "videos" | "comments" | "transcripts";

export type PhaseStatus = "pending" | "running" | "completed" | "failed";

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface Channel {
  id: string;
  handle: string;
  title: string;
  status: ChannelStatus;
  lastError: string | null;
  createdAt: string;
}

export interface PhaseProgress {
  phase: PhaseKey;
  status: PhaseStatus;
  done: number;
  total: number | null;
}

export interface ChannelWithPhases extends Channel {
  phases: Record<PhaseKey, PhaseProgress>;
}

export interface Job {
  id: number;
  channelId: string;
  status: JobStatus;
  createdAt: string;
}