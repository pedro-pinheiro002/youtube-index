import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchDocumentType, SearchResponse, SearchSort, TipoFilter } from "./types";

export const SEARCH_DEBOUNCE_MS = 250;

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
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    setSubmittedQuery(trimmed);
  }, [query, searching]);

  // Debounced auto-search: re-arm a timer whenever `query` changes to a non-empty
  // value. The cleanup clears the pending timer so rapid typing cancels and
  // reschedules the search. submit() bypasses the timer; clear() cancels it.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      debounceTimer.current = null;
      return;
    }
    const timer = setTimeout(() => {
      debounceTimer.current = null;
      setSubmittedQuery(trimmed);
    }, SEARCH_DEBOUNCE_MS);
    debounceTimer.current = timer;
    return () => {
      clearTimeout(timer);
      if (debounceTimer.current === timer) {
        debounceTimer.current = null;
      }
    };
  }, [query]);

  const clear = useCallback(() => {
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    // Bump the sequence so any in-flight fetch is invalidated and cannot
    // overwrite the cleared state when it eventually resolves.
    requestSeq.current += 1;
    setQuery("");
    setSubmittedQuery(null);
    setResults(null);
    setError(null);
    setHasSearched(false);
    setSearching(false);
  }, []);

  useEffect(() => {
    if (submittedQuery !== null) {
      void run(submittedQuery, tipo, sort);
    }
  }, [submittedQuery, tipo, sort, run]);

  useEffect(() => {
    return () => {
      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  return {
    query,
    setQuery,
    tipo,
    setTipo,
    sort,
    setSort,
    submit,
    clear,
    results,
    searching,
    error,
    hasSearched,
  };
}
