import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyPgSchema,
  closePgPool,
  createPgPool,
  PostgresLedger,
  rebuildFtsInPool,
  type CommentRecord,
  type Pool,
  type TranscriptSegmentRecord,
  type VideoRecord,
} from "@youtube-index/domain";

/**
 * Teste de integração do utilitário `rebuildFts` (slice #46). A
 * expressão da coluna `fts` é `generated always as (...) stored`, então
 * o estado normal já está sincronizado com as colunas textuais. Para
 * testar o utilitário nós DROPPAMOS a coluna `fts` e a recriamos como
 * coluna vazia (`tsvector NULL`), simulando uma migração que adicionou
 * a coluna depois do dado existir. Depois chamamos `rebuildFtsInPool`
 * e verificamos que todas as linhas voltam a ter `fts` populada e que
 * a Busca por tsvector funciona.
 *
 * Pré-requisito: Postgres acessível em DATABASE_URL (padrão
 * `postgres://postgres:postgres@localhost:5432/youtube_index`).
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/youtube_index";

let testCounter = 0;
function uniqueChannelId(suffix: string): string {
  testCounter += 1;
  return `UC_REBUILD_FTS_${process.pid}_${testCounter}_${suffix}`;
}

describe("POSTGRES rebuildFts (slice #46)", () => {
  let pool: Pool;
  const createdChannelIds: string[] = [];

  beforeAll(async () => {
    pool = createPgPool({ databaseUrl: DATABASE_URL });
    await applyPgSchema(pool);
  });

  afterAll(async () => {
    if (createdChannelIds.length > 0) {
      await pool.query("DELETE FROM channels WHERE id = ANY($1)", [createdChannelIds]);
    }
    await closePgPool(pool);
  });

  async function seed(channelId: string): Promise<{
    videoId: string;
    commentId: string;
    segmentId: string;
  }> {
    const ledger = new PostgresLedger(pool);
    await ledger.createChannel({ channelId, handle: "@rebuild-fts", title: "Canal Rebuild Fts" });
    const videoId = `vs_rebuild_${testCounter}_a`;
    const video: VideoRecord = {
      id: videoId,
      channelId,
      title: "Como treinar um gato preto comportamento",
      description: "dicas de comportamento felino",
      publishedAt: "2023-01-01T00:00:00Z",
      views: 100,
      likes: 10,
      durationSeconds: 120,
    };
    await ledger.upsertVideo(video);
    const commentId = `cs_rebuild_${testCounter}_a`;
    const comment: CommentRecord = {
      id: commentId,
      videoId,
      channelId,
      author: "Gato Funky",
      text: "Adorei as dicas de comportamento",
      likes: 5,
      publishedAt: "2023-01-01T00:00:00Z",
    };
    await ledger.upsertComment(comment);
    const segmentId = `ss_rebuild_${testCounter}_a`;
    const segment: TranscriptSegmentRecord = {
      id: segmentId,
      videoId,
      channelId,
      start: 0,
      end: 5,
      text: "Hoje vamos falar sobre gatos pretos",
    };
    await ledger.upsertTranscriptSegment(segment);
    createdChannelIds.push(channelId);
    return { videoId, commentId, segmentId };
  }

  it("repopula `fts` nas três tabelas depois de uma migração que esvaziou a coluna", async () => {
    const channelId = uniqueChannelId("basic");
    await seed(channelId);

    // Simula uma migração que removeu a coluna `fts` gerada e a
    // recriou como NULL (estado em que `rebuildFts` precisa operar).
    await pool.query("ALTER TABLE videos DROP COLUMN fts");
    await pool.query("ALTER TABLE videos ADD COLUMN fts tsvector");
    await pool.query("ALTER TABLE comments DROP COLUMN fts");
    await pool.query("ALTER TABLE comments ADD COLUMN fts tsvector");
    await pool.query("ALTER TABLE transcript_segments DROP COLUMN fts");
    await pool.query("ALTER TABLE transcript_segments ADD COLUMN fts tsvector");

    // Confirma que a Busca lexical falha enquanto a coluna está NULL.
    const before = await pool.query("SELECT count(*)::int AS n FROM videos WHERE fts IS NOT NULL");
    expect(before.rows[0].n).toBe(0);

    await rebuildFtsInPool(pool, channelId);

    const after = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM videos WHERE channel_id = $1 AND fts IS NOT NULL) AS videos,
         (SELECT count(*)::int FROM comments c JOIN videos v ON v.id = c.video_id WHERE v.channel_id = $1 AND c.fts IS NOT NULL) AS comments,
         (SELECT count(*)::int FROM transcript_segments t JOIN videos v ON v.id = t.video_id WHERE v.channel_id = $1 AND t.fts IS NOT NULL) AS segments`,
      [channelId],
    );
    expect(after.rows[0]).toEqual({ videos: 1, comments: 1, segments: 1 });

    // Restaura a expressão gerada para não contaminar os próximos testes.
    await pool.query("ALTER TABLE videos DROP COLUMN fts");
    await pool.query(
      `ALTER TABLE videos ADD COLUMN fts tsvector GENERATED ALWAYS AS (
         setweight(to_tsvector('english', coalesce(title, '')), 'A')
         || setweight(to_tsvector('english', coalesce(description, '')), 'B')
       ) STORED`,
    );
    await pool.query("ALTER TABLE comments DROP COLUMN fts");
    await pool.query(
      `ALTER TABLE comments ADD COLUMN fts tsvector GENERATED ALWAYS AS (
         setweight(to_tsvector('english', coalesce(text, '')), 'A')
         || setweight(to_tsvector('english', coalesce(author, '')), 'B')
       ) STORED`,
    );
    await pool.query("ALTER TABLE transcript_segments DROP COLUMN fts");
    await pool.query(
      `ALTER TABLE transcript_segments ADD COLUMN fts tsvector GENERATED ALWAYS AS (
         to_tsvector('english', coalesce(text, ''))
       ) STORED`,
    );
  });
});
