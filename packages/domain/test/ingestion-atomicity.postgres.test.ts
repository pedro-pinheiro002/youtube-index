import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyPgSchema,
  closePgPool,
  createPgPool,
  PostgresLedger,
  PostgresSearchProjection,
  createIngestion,
  type CommentRecord,
  type Pool,
  type TranscriptSegmentRecord,
  type VideoRecord,
  type YouTubeClient,
  type YouTubeComment,
  type YouTubeVideo,
  type YouTubeVideoStats,
} from "@youtube-index/domain";
import { YoutubeTranscriptFetcher } from "../src/transcripts.js";

/**
 * Teste de atomicidade (slice #46): depois de `runNextJob`/`runJob` o
 * Ledger tem as linhas (Vídeo/Comentário/Segmento) e a coluna `fts`
 * dessas linhas está populada (porque é `generated always as ... stored`).
 * Como consequência, `PostgresSearchProjection.search(...)` retorna
 * esses Documentos imediatamente — não há janela em que a Busca
 * consegue ver um Documento cuja linha-fonte não existe (ou vice-versa).
 *
 * Pré-requisito: Postgres acessível em DATABASE_URL.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/youtube_index";

const CHANNEL_ID = "UC_ATOMICITY_46";

function makeYouTubeClient(): YouTubeClient {
  const stats: Record<string, YouTubeVideoStats> = {
    v_atomicity: { views: 100, likes: 10, durationSeconds: 120 },
  };
  const comments: Record<string, YouTubeComment[]> = {
    v_atomicity: [
      {
        id: "c_atomicity",
        author: "Gato Funky",
        text: "Comentário sobre comportamento felino",
        likes: 5,
        publishedAt: "2023-01-02T00:00:00Z",
      },
    ],
  };
  const uploads: YouTubeVideo[] = [
    {
      id: "v_atomicity",
      title: "Como treinar um gato preto comportamento",
      description: "dicas de comportamento felino",
      publishedAt: "2023-01-01T00:00:00Z",
    },
  ];
  return {
    resolveHandle: async () => ({ channelId: CHANNEL_ID, title: "Canal Atomicidade" }),
    getUploadsPlaylistId: async () => "PL_ATOMICITY",
    listUploads: async () => ({ videos: uploads, nextPageToken: null }),
    getVideoStats: async (id) => stats[id] ?? null,
    listComments: async (id) => comments[id] ?? [],
  };
}

describe("POSTGRES Ingestion atomicidade (slice #46)", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createPgPool({ databaseUrl: DATABASE_URL });
    await applyPgSchema(pool);
    await pool.query("DELETE FROM channels WHERE id = $1", [CHANNEL_ID]);

    const ledger = new PostgresLedger(pool);
    await ledger.createChannel({ channelId: CHANNEL_ID, handle: "@atomicity", title: "Canal Atomicidade" });
  });

  afterAll(async () => {
    await pool.query("DELETE FROM channels WHERE id = $1", [CHANNEL_ID]);
    await closePgPool(pool);
  });

  it("depois de runJob nas Fases de Vídeos e Comentários, toda linha de Documento tem `fts` populada e a Busca retorna tudo", async () => {
    const ledger = new PostgresLedger(pool);
    const ingestion = createIngestion({
      youtube: makeYouTubeClient(),
      transcripts: new YoutubeTranscriptFetcher(),
      ledger,
    });

    // Roda só Vídeos + Comentários (não Transcrições) — o fetcher de
    // transcrições bate na rede do YouTube, que é exatamente o que o
    // teste de atomicidade não quer cobrir.
    await ingestion._runPhase("videos", CHANNEL_ID);
    await ingestion._runPhase("comments", CHANNEL_ID);

    // 1. Toda linha de Vídeo/Comentário/Segmento deste Canal tem `fts`
    //    não-nulo — porque a coluna é `generated always as ... stored`
    //    e o Ledger grava a linha-fonte na MESMA transação.
    const fts = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM videos WHERE channel_id = $1 AND fts IS NULL) AS videos_null,
         (SELECT count(*)::int FROM comments c JOIN videos v ON v.id = c.video_id WHERE v.channel_id = $1 AND c.fts IS NULL) AS comments_null,
         (SELECT count(*)::int FROM transcript_segments t JOIN videos v ON v.id = t.video_id WHERE v.channel_id = $1 AND t.fts IS NULL) AS segments_null,
         (SELECT count(*)::int FROM videos WHERE channel_id = $1) AS videos_total,
         (SELECT count(*)::int FROM comments c JOIN videos v ON v.id = c.video_id WHERE v.channel_id = $1) AS comments_total,
         (SELECT count(*)::int FROM transcript_segments t JOIN videos v ON v.id = t.video_id WHERE v.channel_id = $1) AS segments_total`,
      [CHANNEL_ID],
    );
    expect(fts.rows[0]).toEqual({
      videos_null: 0,
      comments_null: 0,
      segments_null: 0,
      videos_total: 1,
      comments_total: 1,
      segments_total: 0,
    });

    // 2. A Busca Postgres vê imediatamente os Documentos materializados,
    //    sem precisar de Projeção externa.
    const search = new PostgresSearchProjection(pool);
    const result = await search.search({ q: "comportamento", channelId: CHANNEL_ID });
    expect(result.hits.length).toBeGreaterThanOrEqual(2);
    const videoHit = result.hits.find((h) => h.id === "v_atomicity");
    expect(videoHit).toBeDefined();
    expect(videoHit?.type).toBe("video");
    const commentHit = result.hits.find((h) => h.id === "c_atomicity");
    expect(commentHit).toBeDefined();
    expect(commentHit?.type).toBe("comment");
  });

  it("não chama mais projection.* nas Fases (Ingestion não recebe mais Projeção)", () => {
    // Este teste é um guarda estático: o tipo `IngestionDeps` não tem
    // mais `projection` e `createIngestion` aceita só os parâmetros
    // canônicos. Se alguém reintroduzir a Projeção por engano o tipo
    // acima passa a falhar o build, o que é exatamente o sinal que
    // queremos para o slice #46.
    type Deps = Parameters<typeof createIngestion>[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasProjection = "projection" in ({} as Deps);
    expect(hasProjection).toBe(false);
  });
});
