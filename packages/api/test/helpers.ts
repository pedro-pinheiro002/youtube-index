import { createDatabase, SqliteLedger } from "@youtube-index/domain";
import type { Ledger, YouTubeClient } from "@youtube-index/domain";
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

export function makeLedger(): Ledger {
  return new SqliteLedger(createDatabase(":memory:"));
}

export function makeYouTubeClient(resolution?: { channelId: string; title: string }): YouTubeClient {
  return {
    resolveHandle: async () => resolution ?? { channelId: "UCY8iijN1AkyDCh1Z9akcqUA", title: "Funky Black Cat" },
  };
}