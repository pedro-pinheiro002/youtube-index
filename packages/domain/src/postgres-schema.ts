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
 * `videos`, `comments` e `transcript_segments` carregam uma coluna
 * `fts tsvector` populada por `GENERATED ALWAYS AS STORED` — o Postgres
 * avalia a expressão `to_tsvector('english', ...)` no momento do
 * INSERT/UPDATE e armazena o resultado na própria linha, na mesma
 * transação. A Busca (slice #45) consulta essa coluna com `tsvector @@
 * tsquery` ranqueada por `ts_rank`, e a coluna `pg_trgm` (GIST/GIN
 * sobre trigramas) cobre o fallback de typos quando `tsquery` retorna
 * zero.
 *
 * Cada comando é separado por `;` e enviado individualmente para
 * garantir que o Postgres interprete cada `CREATE TABLE IF NOT EXISTS`
 * como uma sentença autocontida (um `db.exec(...)` multi-statement
 * exigiria um client conectado em transação explícita).
 */
export const POSTGRES_SCHEMA = `
CREATE EXTENSION IF NOT EXISTS pg_trgm;

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fts tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED
);

CREATE INDEX IF NOT EXISTS videos_fts_idx ON videos USING GIN (fts);
CREATE INDEX IF NOT EXISTS videos_title_trgm_idx ON videos USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS videos_description_trgm_idx ON videos USING GIN (description gin_trgm_ops);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fts tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(text, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(author, '')), 'B')
  ) STORED
);

CREATE INDEX IF NOT EXISTS comments_fts_idx ON comments USING GIN (fts);
CREATE INDEX IF NOT EXISTS comments_text_trgm_idx ON comments USING GIN (text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS comments_author_trgm_idx ON comments USING GIN (author gin_trgm_ops);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id BIGSERIAL PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  start_seconds DOUBLE PRECISION NOT NULL,
  end_seconds DOUBLE PRECISION NOT NULL,
  text TEXT NOT NULL,
  fts tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(text, ''))
  ) STORED
);

CREATE UNIQUE INDEX IF NOT EXISTS transcript_segments_video_start
  ON transcript_segments(video_id, start_seconds);
CREATE INDEX IF NOT EXISTS transcript_segments_fts_idx ON transcript_segments USING GIN (fts);
CREATE INDEX IF NOT EXISTS transcript_segments_text_trgm_idx ON transcript_segments USING GIN (text gin_trgm_ops);

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
 *
 * Adquire um advisory lock em uma única transação dedicada antes de
 * aplicar o schema — vitest roda arquivos de teste em paralelo por
 * padrão, e dois `applyPgSchema` simultâneos disputam
 * `pg_class_relname_nsp_index` ao criar o mesmo índice
 * (`videos_fts_idx`, `comments_fts_idx`, etc.) mesmo com `IF NOT
 * EXISTS`. O lock serializa o bootstrap sem precisar de uma transação
 * explícita no caller.
 */
export async function applyPgSchema(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(73650042)");
    for (const statement of POSTGRES_SCHEMA.split(/;\s*\n/).map((s) => s.trim()).filter((s) => s.length > 0)) {
      await client.query(statement);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}