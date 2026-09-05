import type { IngestionQueue, Ledger, SearchParams, SearchPort, SearchResponse, YouTubeClient } from "@youtube-index/domain";
import type { AppConfig } from "../src/config.js";

export function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: "127.0.0.1",
    port: 3000,
    databaseUrl: "",
    pollIntervalMs: 1000,
    webDistDir: null,
    youtubeApiKey: "test-key",
    logger: false,
    ...overrides,
  };
}

// Os testes da api compartilham Postgres (slice #48). `makeLedger` /
// `makeQueue` retornam tipos — não instâncias — para deixar claro que
// cada teste deve construir os seus a partir de um `pg.Pool` próprio
// (ver channels.postgres.test.ts e search.postgres.test.ts). Os
// testes HTTP-level injetam stubs (makeStubQueue, makeStubSearch).
export type { Ledger, IngestionQueue };

export function makeSearchClient(
  results?: SearchResponse,
): { search: SearchPort["search"]; calls: SearchParams[] } {
  const calls: SearchParams[] = [];
  return {
    search: async (params: SearchParams): Promise<SearchResponse> => {
      calls.push(params);
      return results ?? { hits: [], total: 0, query: params.q };
    },
    calls,
  };
}

export function makeYouTubeClient(resolution?: { channelId: string; title: string }): YouTubeClient {
  return {
    resolveHandle: async () => resolution ?? { channelId: "UCY8iijN1AkyDCh1Z9akcqUA", title: "Funky Black Cat" },
    getUploadsPlaylistId: async () => {
      throw new Error("não usado neste teste");
    },
    listUploads: async () => {
      throw new Error("não usado neste teste");
    },
    getVideoStats: async () => {
      throw new Error("não usado neste teste");
    },
    listComments: async () => {
      throw new Error("não usado neste teste");
    },
  };
}
