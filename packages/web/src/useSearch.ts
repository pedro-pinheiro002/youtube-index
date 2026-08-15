import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchDocumentType, SearchResponse, SearchSort, TipoFilter } from "./types";

export interface SearchApi {
  searchChannel: (params: {
    q: string;
    channelId: string;
    tipo?: SearchDocumentType;
    sort?: SearchSort;
  }) => Promise<SearchResponse>;
}

export interface UseSearchOptions {
  channelId: string;
  api: SearchApi;
}

export function useSearch({ channelId, api }: UseSearchOptions) {
  const [query, setQuery] = useState("");
  const [tipo, setTipo] = useState<TipoFilter>("all");
  const [sort, setSort] = useState<SearchSort>("relevance");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const run = useCallback(
    async (q: string, currentTipo: TipoFilter, currentSort: SearchSort) => {
      const seq = ++requestSeq.current;
      setSearching(true);
      setError(null);
      try {
        const response = await api.searchChannel({
          q,
          channelId,
          tipo: currentTipo === "all" ? undefined : currentTipo,
          sort: currentSort,
        });
        if (seq !== requestSeq.current) {
          return;
        }
        setResults(response);
        setHasSearched(true);
      } catch (err) {
        if (seq !== requestSeq.current) {
          return;
        }
        setError(err instanceof Error ? err.message : "Falha na busca");
      } finally {
        if (seq === requestSeq.current) {
          setSearching(false);
        }
      }
    },
    [api, channelId],
  );

  const submit = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed || searching) {
      return;
    }
    setSubmittedQuery(trimmed);
  }, [query, searching]);

  useEffect(() => {
    if (submittedQuery !== null) {
      void run(submittedQuery, tipo, sort);
    }
  }, [submittedQuery, tipo, sort, run]);

  return {
    query,
    setQuery,
    tipo,
    setTipo,
    sort,
    setSort,
    submit,
    results,
    searching,
    error,
    hasSearched,
  };
}
