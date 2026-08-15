import type { SearchDocumentType } from "./projection.js";

export type SearchSort = "relevance" | "publishedAt";

export interface SearchParams {
  q: string;
  channelId: string;
  tipo?: SearchDocumentType;
  sort?: SearchSort;
  limit?: number;
}

export interface SearchHit {
  id: string;
  channelId: string;
  type: SearchDocumentType;
  [key: string]: unknown;
  _formatted: Record<string, unknown>;
}

export interface SearchResponse {
  hits: SearchHit[];
  total: number;
  query: string;
}

export interface SearchPort {
  search(params: SearchParams): Promise<SearchResponse>;
}
