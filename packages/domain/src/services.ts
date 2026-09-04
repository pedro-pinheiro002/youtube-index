import type { DatabaseSync } from "node:sqlite";
import type pg from "pg";
import type { Ledger } from "./ledger.js";
import type { IngestionQueue } from "./ingestion-queue.js";
import type { YouTubeClient } from "./youtube.js";
import type { TranscriptFetcher } from "./transcripts.js";
import type { Projection } from "./documento.js";
import type { SearchPort } from "./search.js";
import type { Ingestion, IngestionLogger } from "./ingestion.js";
import { SqliteLedger } from "./ledger.js";
import { PostgresLedger } from "./postgres-ledger.js";
import { SqliteIngestionQueue } from "./ingestion-queue.js";
import { PostgresIngestionQueue } from "./postgres-queue.js";
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
  db: DatabaseSync | pg.Pool;
  config: ServicesConfig;
  logger?: IngestionLogger;
  fetchImpl?: typeof fetch;
}

/**
 * Detecta `pg.Pool` pelo nome da construtora. Node-postgres expõe o nome
 * "Pool" no construtor; rodar `instanceof pg.Pool` também funcionaria mas
 * exigiria importar `pg` em runtime (a forma atual evita isso, já que o
 * guard é só para `selectLedger`/`selectQueue`).
 */
function isPgPool(db: DatabaseSync | pg.Pool): db is pg.Pool {
  return (db as { constructor?: { name?: string } }).constructor?.name === "Pool";
}

function selectLedger(db: DatabaseSync | pg.Pool): Ledger {
  if (isPgPool(db)) {
    return new PostgresLedger(db);
  }
  return new SqliteLedger(db);
}

function selectQueue(db: DatabaseSync | pg.Pool): IngestionQueue {
  if (isPgPool(db)) {
    // Stub: a Fila Postgres-backed entra em #44. Cada método lança
    // NotImplementedError para deixar o caller saber exatamente o que
    // esperar (em vez de misturar SQLite sobre Pool, que falharia de
    // forma confusa em runtime).
    return new PostgresIngestionQueue();
  }
  return new SqliteIngestionQueue(db);
}

export async function createServices(params: CreateServicesParams): Promise<Services> {
  const { db, config, logger, fetchImpl } = params;

  if (!config.youtubeApiKey) {
    throw new MissingConfigError("youtubeApiKey");
  }

  const ledger = selectLedger(db);
  const queue = selectQueue(db);

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
