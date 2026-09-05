import type { Pool } from "pg";
import { closePgPool, createPgPool } from "./postgres.js";

/**
 * Recalcula a coluna `fts` (tsvector) de todas as linhas de um Canal em
 * `videos`, `comments` e `transcript_segments`. Não chama a YouTube Data
 * API — opera puramente sobre as linhas já materializadas no Ledger.
 *
 * No Postgres atual a coluna `fts` é `GENERATED ALWAYS AS (...) STORED`,
 * então ela se mantém sincronizada com `title`/`description`/`text` a
 * cada INSERT/UPDATE do Ledger sem precisar deste utilitário. Ele
 * continua existindo porque serve como ferramenta operacional após
 * migrações de schema (ex.: quando a expressão de geração muda ou
 * quando uma coluna é adicionada a uma tabela com linhas pré-existentes
 * que precisam de backfill do `fts`).
 *
 * É deliberadamente idempotente — chamar `rebuildFts(channelId)` várias
 * vezes produz o mesmo resultado — e o `Pool` é fechado quando o
 * próprio script terminou.
 */
export async function rebuildFts(channelId: string): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL é obrigatório para rebuildFts");
  }
  const pool = createPgPool({ databaseUrl });
  try {
    await rebuildFtsInPool(pool, channelId);
  } finally {
    await closePgPool(pool);
  }
}

/**
 * Variante que recebe um `Pool` explícito — útil para testes que já
 * têm um Pool compartilhado (não queremos que cada chamada de teste
 * crie e feche o seu próprio).
 */
export async function rebuildFtsInPool(pool: Pool, channelId: string): Promise<void> {
  await pool.query(
    `UPDATE videos
     SET fts = setweight(to_tsvector('english', coalesce(title, '')), 'A')
           || setweight(to_tsvector('english', coalesce(description, '')), 'B')
     WHERE channel_id = $1`,
    [channelId],
  );
  await pool.query(
    `UPDATE comments c
     SET fts = setweight(to_tsvector('english', coalesce(c.text, '')), 'A')
           || setweight(to_tsvector('english', coalesce(c.author, '')), 'B')
     FROM videos v
     WHERE c.video_id = v.id AND v.channel_id = $1`,
    [channelId],
  );
  await pool.query(
    `UPDATE transcript_segments t
     SET fts = to_tsvector('english', coalesce(t.text, ''))
     FROM videos v
     WHERE t.video_id = v.id AND v.channel_id = $1`,
    [channelId],
  );
}
