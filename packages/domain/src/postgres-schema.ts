import type pg from "pg";

/**
 * Erro lançado pelos métodos do PostgresLedger fora do escopo do slice
 * atual (#42). Aponta para a issue que vai implementar a operação,
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
 * Tabelas mínimas necessárias para o slice "channel lifecycle" (#42).
 * Cobrem o ciclo de vida do Canal (criação, fases de ingestão) e a fila
 * de ingestão. Tabelas adicionais (vídeos, comentários, segmentos)
 * serão adicionadas nos próximos slices do parent #41.
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

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id BIGSERIAL PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

/**
 * Cria as tabelas mínimas do PostgresLedger idempotentemente. Cada
 * comando é separado por `;` e enviado individualmente para garantir
 * que o Postgres interprete cada `CREATE TABLE IF NOT EXISTS` como uma
 * sentença autocontida. Um único `db.exec(...)` (multi-statement)
 * exigiria um client conectado em transação explícita, então separamos
 * para usar o `pool.query` direto.
 */
export async function applyPgSchema(pool: pg.Pool): Promise<void> {
  for (const statement of POSTGRES_SCHEMA.split(/;\s*\n/).map((s) => s.trim()).filter((s) => s.length > 0)) {
    await pool.query(statement);
  }
}