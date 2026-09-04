import type pg from "pg";

/**
 * Erro lançado pelos métodos do PostgresLedger fora do escopo do slice
 * atual. Aponta para a issue que vai implementar a operação,
 * permitindo que o caller saiba o que esperar em vez de receber um erro
 * genérico.
 */
export class NotImplementedError extends Error {
  override readonly name = "NotImplementedError";
  constructor(
    public readonly method: string,
    public readonly className: string,
    public readonly trackingIssue: string,
  ) {
    super(`${className}.${method} ainda não foi implementado; veja ${trackingIssue}`);
  }
}

/**
 * Tabelas do PostgresLedger. Espelham as tabelas SQLite definidas em
 * `schema.ts` (mesmas colunas e constraints, tipos Postgres apropriados).
 *
 * `videos`, `comments` e `transcript_segments` ganham uma coluna
 * `fts tsvector` (slice #46 vai popular essa coluna em transação com o
 * INSERT). A coluna já existe aqui para evitar migração posterior; o
 * slice #43 só grava a coluna em NULL — sem `fts`, as buscas do slice
 * #45 não retornam nada até #46 popular.
 *
 * Cada comando é separado por `;` e enviado individualmente para
 * garantir que o Postgres interprete cada `CREATE TABLE IF NOT EXISTS`
 * como uma sentença autocontida (um `db.exec(...)` multi-statement
 * exigiria um client conectado em transação explícita).
 */
export const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS channel_phases (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  total INTEGER,
  PRIMARY KEY (channel_id, phase)
);

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  published_at TEXT,
  views BIGINT,
  likes BIGINT,
  duration_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id BIGSERIAL PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  start_seconds DOUBLE PRECISION NOT NULL,
  end_seconds DOUBLE PRECISION NOT NULL,
  text TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS transcript_segments_video_start
  ON transcript_segments(video_id, start_seconds);

CREATE TABLE IF NOT EXISTS transcript_absences (
  video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comment_absences (
  video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id BIGSERIAL PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

/**
 * Cria as tabelas do PostgresLedger idempotentemente.
 */
export async function applyPgSchema(pool: pg.Pool): Promise<void> {
  for (const statement of POSTGRES_SCHEMA.split(/;\s*\n/).map((s) => s.trim()).filter((s) => s.length > 0)) {
    await pool.query(statement);
  }
}