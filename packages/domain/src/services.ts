import type pg from "pg";
import type { Ledger } from "./postgres-ledger.js";
import type { IngestionQueue } from "./ingestion-queue.js";
import type { YouTubeClient } from "./youtube.js";
import type { TranscriptFetcher } from "./transcripts.js";
import type { Projection } from "./documento.js";
import type { SearchPort } from "./search.js";
import type { Ingestion, IngestionLogger } from "./ingestion.js";
import { PostgresLedger } from "./postgres-ledger.js";
import { PostgresIngestionQueue } from "./postgres-queue.js";
import { YouTubeDataApiClient } from "./youtube.js";
import { YoutubeTranscriptFetcher } from "./transcripts.js";
import { PostgresSearchProjection } from "./postgres-search.js";
import { createIngestion } from "./ingestion.js";

export class MissingConfigError extends Error {
  override readonly name = "MissingConfigError";
  constructor(field: string) {
    super(`Missing required config field: ${field}`);
  }
}

export interface ServicesConfig {
  youtubeApiKey: string;
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
  pool: pg.Pool;
  config: ServicesConfig;
  logger?: IngestionLogger;
}

/**
 * Constrói os serviços em torno do Postgres (único backend, slice #48).
 * A coluna `fts` (tsvector gerado) é o Índice de Busca — não há
 * Projeção externa — então a mesma instância de `PostgresSearchProjection`
 * serve para `projection` (no-op, satisfaz o contrato da Ingestão) e
 * para `search`.
 */
export async function createServices(params: CreateServicesParams): Promise<Services> {
  const { pool, config, logger } = params;

  if (!config.youtubeApiKey) {
    throw new MissingConfigError("youtubeApiKey");
  }

  const ledger = new PostgresLedger(pool);
  const queue = new PostgresIngestionQueue(pool);
  const youtube = new YouTubeDataApiClient(config.youtubeApiKey);
  const transcripts = new YoutubeTranscriptFetcher();

  const projection: Projection & SearchPort = new PostgresSearchProjection(pool);

  const ingestion = createIngestion({
    youtube,
    transcripts,
    ledger,
    logger,
    recentWindowDays: config.recentWindowDays,
  });

  const search: SearchPort = projection;

  return { ledger, queue, youtube, transcripts, projection, ingestion, search };
}
