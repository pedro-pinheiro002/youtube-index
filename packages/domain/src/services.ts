import type { DatabaseSync } from "node:sqlite";
import type { Ledger } from "./ledger.js";
import type { IngestionQueue } from "./ingestion-queue.js";
import type { YouTubeClient } from "./youtube.js";
import type { TranscriptFetcher } from "./transcripts.js";
import type { Projection } from "./documento.js";
import type { SearchPort } from "./search.js";
import type { Ingestion, IngestionLogger } from "./ingestion.js";
import { SqliteLedger } from "./ledger.js";
import { SqliteIngestionQueue } from "./ingestion-queue.js";
import { YouTubeDataApiClient } from "./youtube.js";
import { YoutubeTranscriptFetcher } from "./transcripts.js";
import { createMeilisearchProjection } from "./meilisearch.js";
import { createIngestion } from "./ingestion.js";

export class MissingConfigError extends Error {
  override readonly name = "MissingConfigError";
  constructor(field: string) {
    super(`Missing required config field: ${field}`);
  }
}

export interface ServicesConfig {
  youtubeApiKey: string;
  meilisearchUrl: string;
  meilisearchMasterKey: string;
  recentWindowDays?: number;
}

export interface Services {
  ledger: Ledger;
  queue: IngestionQueue;
  youtube: YouTubeClient;
  transcripts: TranscriptFetcher;
  projection: Projection;
  ingestion: Ingestion;
  search: SearchPort;
}

export interface CreateServicesParams {
  db: DatabaseSync;
  config: ServicesConfig;
  logger?: IngestionLogger;
  fetchImpl?: typeof fetch;
}

export async function createServices(params: CreateServicesParams): Promise<Services> {
  const { db, config, logger, fetchImpl } = params;

  if (!config.youtubeApiKey) {
    throw new MissingConfigError("youtubeApiKey");
  }

  const ledger = new SqliteLedger(db);
  const queue = new SqliteIngestionQueue(db);
  const youtube = new YouTubeDataApiClient(config.youtubeApiKey);
  const transcripts = new YoutubeTranscriptFetcher();

  const projection = await createMeilisearchProjection({
    url: config.meilisearchUrl,
    masterKey: config.meilisearchMasterKey,
    fetchImpl,
  });

  const ingestion = createIngestion({
    youtube,
    transcripts,
    ledger,
    projection,
    logger,
    recentWindowDays: config.recentWindowDays,
  });

  // MeilisearchProjection implements both Projection and SearchPort
  const search: SearchPort = projection;

  return { ledger, queue, youtube, transcripts, projection, ingestion, search };
}