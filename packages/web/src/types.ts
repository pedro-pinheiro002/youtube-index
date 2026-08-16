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

export type SearchDocumentType = "video" | "comment" | "segment";

export type SearchSort = "relevance" | "publishedAt";

export type TipoFilter = "all" | SearchDocumentType;

export interface SearchHitBase {
  id: string;
  channelId: string;
  _formatted?: Record<string, unknown>;
}

export interface VideoSearchHit extends SearchHitBase {
  type: "video";
  title: string;
  description: string;
  views: number;
  likes: number;
  durationSeconds: number;
  url: string;
  thumbnail: string;
  publishedAt: string;
}

export interface VideoContextSearchHit extends SearchHitBase {
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  videoThumbnail: string;
  videoViews: number;
  videoLikes: number;
  publishedAt: string;
}

export interface CommentSearchHit extends VideoContextSearchHit {
  type: "comment";
  url: string;
  author: string;
  text: string;
  likes: number;
}

export interface SegmentSearchHit extends VideoContextSearchHit {
  type: "segment";
  text: string;
  start: number;
  end: number;
  url: string;
}

export type SearchHit = VideoSearchHit | CommentSearchHit | SegmentSearchHit;

export interface SearchResponse {
  hits: SearchHit[];
  total: number;
  query: string;
}

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