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
  lastError: string | null;
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

import type {
  SearchDocumentType,
  SearchHit,
  SearchResponse,
  SearchSort,
} from "@youtube-index/domain";

export type {
  SearchDocumentType,
  SearchHit,
  SearchResponse,
  SearchSort,
} from "@youtube-index/domain";

export type TipoFilter = "all" | SearchDocumentType;

export const SEARCH_TIPO_LABELS: Record<TipoFilter, string> = {
  all: "Todos",
  video: "Vídeo",
  comment: "Comentário",
  segment: "Transcrição",
};

export const SEARCH_SORT_LABELS: Record<SearchSort, string> = {
  relevance: "Relevância",
  publishedAt: "Data de publicação",
};
