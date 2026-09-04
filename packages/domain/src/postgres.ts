import pg from "pg";

export type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

export interface CreatePgPoolParams {
  databaseUrl: string;
  /**
   * Tamanho máximo do pool. Padrão conservador de 10 conexões — suficiente para a
   * carga local (api + worker in-process + testes) sem esgotar o Postgres de dev.
   */
  max?: number;
}

export function createPgPool(params: CreatePgPoolParams): pg.Pool {
  if (!params.databaseUrl) {
    throw new Error("createPgPool: databaseUrl é obrigatório");
  }
  return new pg.Pool({
    connectionString: params.databaseUrl,
    max: params.max ?? 10,
  });
}

/**
 * Fecha um pool do Postgres de forma idempotente. Erros são engolidos porque o
 * shutdown do backend não pode falhar só porque o pool já estava fechado.
 */
export async function closePgPool(pool: pg.Pool): Promise<void> {
  try {
    await pool.end();
  } catch {
    // já fechado ou outro erro não-crítico; ignora
  }
}