import { createDatabase, SqliteIngestionQueue, SqliteLedger } from "@youtube-index/domain";
import type { IngestionQueue, Ledger, SearchParams, SearchPort, SearchResponse, YouTubeClient } from "@youtube-index/domain";
import type { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../src/config.js";

export function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: "127.0.0.1",
    port: 3000,
    meiliUrl: "http://localhost:7700",
    meiliMasterKey: "test-master-key",
    webDistDir: null,
    dbPath: ":memory:",
    youtubeApiKey: "test-key",
    logger: false,
    ...overrides,
  };
}

export function makeDb(): DatabaseSync {
  return createDatabase(":memory:");
}

export function makeLedger(db: DatabaseSync = makeDb()): Ledger {
  return new SqliteLedger(db);
}

export function makeQueue(db: DatabaseSync = makeDb()): IngestionQueue {
  return new SqliteIngestionQueue(db);
}

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