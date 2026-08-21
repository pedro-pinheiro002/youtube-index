import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SearchResponse } from "../src/types";
import { useSearch } from "../src/useSearch";
import { makeSearchApi, makeSearchResponse } from "./helpers";

const CHANNEL_ID = "UCY8iijN1AkyDCh1Z9akcqUA";

describe("useSearch", () => {
  it("submit busca com a consulta e o canal, ordenando por relevância por padrão", async () => {
    const searchChannel = vi.fn().mockResolvedValue(makeSearchResponse());
    const api = makeSearchApi({ searchChannel });
    const { result } = renderHook(() => useSearch({ channelId: CHANNEL_ID, api }));

    act(() => result.current.setQuery("gato"));
    act(() => result.current.submit());

    await waitFor(() => expect(result.current.results?.total).toBe(1));
    expect(searchChannel).toHaveBeenCalledWith({ q: "gato", channelId: CHANNEL_ID, sort: "relevance" });
  });

  it("mudar o tipo re-executa a busca da última consulta com o filtro", async () => {
    const searchChannel = vi.fn().mockResolvedValue(makeSearchResponse());
    const api = makeSearchApi({ searchChannel });
    const { result } = renderHook(() => useSearch({ channelId: CHANNEL_ID, api }));

    act(() => result.current.setQuery("gato"));
    act(() => result.current.submit());
    await waitFor(() => expect(searchChannel).toHaveBeenCalledTimes(1));

    act(() => result.current.setTipo("comment"));
    await waitFor(() => expect(searchChannel).toHaveBeenCalledTimes(2));

    expect(searchChannel.mock.calls[1]?.[0]).toEqual({
      q: "gato",
      channelId: CHANNEL_ID,
      tipo: "comment",
      sort: "relevance",
    });
  });

  it("mudar a ordenação re-executa a busca da última consulta", async () => {
    const searchChannel = vi.fn().mockResolvedValue(makeSearchResponse());
    const api = makeSearchApi({ searchChannel });
    const { result } = renderHook(() => useSearch({ channelId: CHANNEL_ID, api }));

    act(() => result.current.setQuery("gato"));
    act(() => result.current.submit());
    await waitFor(() => expect(searchChannel).toHaveBeenCalledTimes(1));

    act(() => result.current.setSort("publishedAt"));
    await waitFor(() => expect(searchChannel).toHaveBeenCalledTimes(2));

    expect(searchChannel.mock.calls[1]?.[0]).toEqual({
      q: "gato",
      channelId: CHANNEL_ID,
      sort: "publishedAt",
    });
  });

  it("expõe o erro da API quando a busca falha", async () => {
    const searchChannel = vi.fn().mockRejectedValue(new Error("Canal não encontrado"));
    const api = makeSearchApi({ searchChannel });
    const { result } = renderHook(() => useSearch({ channelId: CHANNEL_ID, api }));

    act(() => result.current.setQuery("gato"));
    act(() => result.current.submit());

    await waitFor(() => expect(result.current.error).toBe("Canal não encontrado"));
    expect(result.current.results).toBeNull();
    expect(result.current.searching).toBe(false);
  });

  it("ignora respostas fora de ordem quando filtros mudam durante a busca", async () => {
    const searchChannel = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(makeSearchResponse({ query: "gato", hits: [], total: 99 })), 50),
          ),
      )
      .mockImplementationOnce(() => Promise.resolve(makeSearchResponse({ query: "gato", total: 1 })));
    const api = makeSearchApi({ searchChannel });
    const { result } = renderHook(() => useSearch({ channelId: CHANNEL_ID, api }));

    act(() => result.current.setQuery("gato"));
    act(() => result.current.submit());
    act(() => result.current.setTipo("video"));

    await waitFor(() => expect(result.current.results?.total).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(result.current.results?.total).toBe(1);
    expect(result.current.searching).toBe(false);
  });
});

describe("useSearch debounce + Enter + Esc", () => {
  it("dispara a busca após 250ms de inatividade na digitação", async () => {
    vi.useFakeTimers();
    try {
      const searchChannel = vi.fn().mockResolvedValue(makeSearchResponse());
      const api = makeSearchApi({ searchChannel });
      const { result } = renderHook(() => useSearch({ channelId: CHANNEL_ID, api }));

      act(() => result.current.setQuery("gato"));
      expect(searchChannel).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(249);
      });
      expect(searchChannel).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(1);
        await Promise.resolve();
      });

      expect(searchChannel).toHaveBeenCalledTimes(1);
      expect(searchChannel).toHaveBeenCalledWith({ q: "gato", channelId: CHANNEL_ID, sort: "relevance" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancela a busca agendada quando o usuário continua digitando", async () => {
    vi.useFakeTimers();
    try {
      const searchChannel = vi.fn().mockResolvedValue(makeSearchResponse());
      const api = makeSearchApi({ searchChannel });
      const { result } = renderHook(() => useSearch({ channelId: CHANNEL_ID, api }));

      act(() => result.current.setQuery("g"));
      act(() => {
        vi.advanceTimersByTime(100);
      });
      act(() => result.current.setQuery("ga"));
      act(() => {
        vi.advanceTimersByTime(100);
      });
      act(() => result.current.setQuery("gato"));

      // Total advance from "gato" setQuery = 0ms. Advance the full 250ms from
      // the last keystroke; intermediate keystrokes already cancelled their
      // respective timers via the query effect's cleanup.
      await act(async () => {
        vi.advanceTimersByTime(250);
        await Promise.resolve();
      });

      expect(searchChannel).toHaveBeenCalledTimes(1);
      expect(searchChannel).toHaveBeenCalledWith({ q: "gato", channelId: CHANNEL_ID, sort: "relevance" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("Enter dispara a busca imediatamente, sem esperar o debounce", async () => {
    vi.useFakeTimers();
    try {
      const searchChannel = vi.fn().mockResolvedValue(makeSearchResponse());
      const api = makeSearchApi({ searchChannel });
      const { result } = renderHook(() => useSearch({ channelId: CHANNEL_ID, api }));

      act(() => result.current.setQuery("gato"));
      // No timer advance — Enter must bypass the debounce.
      await act(async () => {
        act(() => result.current.submit());
        await Promise.resolve();
      });

      expect(searchChannel).toHaveBeenCalledTimes(1);
      expect(searchChannel).toHaveBeenCalledWith({ q: "gato", channelId: CHANNEL_ID, sort: "relevance" });

      // Advance past the debounce window: no extra call should fire because
      // submit() cleared the pending timer.
      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
      });
      expect(searchChannel).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Esc limpa query, results, error, submittedQuery e hasSearched", async () => {
    const searchChannel = vi.fn().mockResolvedValue(makeSearchResponse());
    const api = makeSearchApi({ searchChannel });
    const { result } = renderHook(() => useSearch({ channelId: CHANNEL_ID, api }));

    act(() => result.current.setQuery("gato"));
    act(() => result.current.submit());
    await waitFor(() => expect(result.current.results?.total).toBe(1));
    expect(result.current.hasSearched).toBe(true);

    act(() => result.current.clear());

    expect(result.current.query).toBe("");
    expect(result.current.results).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.hasSearched).toBe(false);

    // clear() must not trigger a follow-up search even after the debounce
    // window has elapsed.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(searchChannel).toHaveBeenCalledTimes(1);
  });

  it("race-guard preservado com debounce: respostas fora de ordem não sobrescrevem estado mais novo", async () => {
    let resolveFirst: ((value: SearchResponse) => void) | null = null;
    const searchChannel = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<SearchResponse>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockImplementationOnce(() => Promise.resolve(makeSearchResponse({ query: "gato", total: 7 })));
    const api = makeSearchApi({ searchChannel });
    const { result } = renderHook(() => useSearch({ channelId: CHANNEL_ID, api }));

    // Trigger debounce by typing and waiting past 250ms.
    act(() => result.current.setQuery("gato"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
    expect(searchChannel).toHaveBeenCalledTimes(1);
    expect(searchChannel.mock.calls[0]?.[0]).toEqual({
      q: "gato",
      channelId: CHANNEL_ID,
      sort: "relevance",
    });

    // While the first fetch is in flight, the user changes the filter — the
    // submittedQuery/tipo/sort effect re-fires run() with seq=2.
    act(() => result.current.setTipo("comment"));
    await waitFor(() => expect(searchChannel).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.results?.total).toBe(7));

    // Now the stale first fetch resolves with a different total — it must be
    // discarded by the race-guard.
    await act(async () => {
      resolveFirst?.(makeSearchResponse({ query: "gato", total: 99 }));
    });

    expect(result.current.results?.total).toBe(7);
  });
});
