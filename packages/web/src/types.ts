export type ChannelStatus = "queued" | "ingesting" | "completed" | "failed";

export type PhaseKey = "videos" | "comments" | "transcripts";

export type PhaseStatus = "pending" | "running" | "completed" | "failed";

export interface PhaseProgress {
  phase: PhaseKey;
  status: PhaseStatus;
  done: number;
  total: number | null;
}

export interface ChannelWithPhases {
  id: string;
  handle: string;
  title: string;
  status: ChannelStatus;
  createdAt: string;
  phases: Record<PhaseKey, PhaseProgress>;
}

export function isTerminalStatus(status: ChannelStatus): boolean {
  return status === "completed" || status === "failed";
}

export const PHASES: readonly PhaseKey[] = ["videos", "comments", "transcripts"];

export const PHASE_LABELS: Record<PhaseKey, string> = {
  videos: "Vídeos",
  comments: "Comentários",
  transcripts: "Transcrições",
};