import type { Documento, SearchDocumentType } from "./documento.js";

export type SearchSort = "relevance" | "publishedAt";

export interface SearchParams {
  q: string;
  channelId: string;
  tipo?: SearchDocumentType;
  sort?: SearchSort;
  limit?: number;
}

/**
 * O que volta de uma Busca: a união discriminada de Documentos
 * com o highlight do Meilisearch anexado.
 */
export type SearchHit = Documento & { _formatted?: Record<string, unknown> };

export interface SearchResponse {
  hits: SearchHit[];
  total: number;
  query: string;
}

export interface SearchPort {
  search(params: SearchParams): Promise<SearchResponse>;
}
