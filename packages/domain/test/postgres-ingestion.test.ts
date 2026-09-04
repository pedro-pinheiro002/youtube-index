import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyPgSchema,
  closePgPool,
  CommentsDisabledError,
  createIngestion,
  createPgPool,
  PostgresLedger,
  type Ingestion,
  type Ledger,
  type Pool,
  type Projection,
  type Transcript,
  type TranscriptFetcher,
  type TranscriptResult,
  type YouTubeClient,
  type YouTubeComment,
  type YouTubeVideoStats,
} from "@youtube-index/domain";

/**
 * Teste de integração que valida o slice #43: o pipeline de Ingestão
 * (Vídeos → Comentários → Transcrições) escreve Vídeos, Comentários e
 * Segmentos via `PostgresLedger` end-to-end.
 *
 * Diferente do `ledger.test.ts` (que testa cada método do Ledger em
 * isolamento), aqui dirigimos `Ingestion.runJob` com o `PostgresLedger`
 * real e verificamos o estado pós-ingestão via SQL direto + leituras
 * do Ledger.
 *
 * Cada teste usa um `channelId` único e ids de Vídeo/Comentário/
 * Segmento também únicos para isolar entre testes paralelos. Os canais
 * são deletados no `afterAll` (cascade cobre Vídeos, Comentários,
 * Segmentos e ausências).
 *
 * Pré-requisito: Postgres acessível em DATABASE_URL (padrão
 * `postgres://postgres:postgres@localhost:5432/youtube_index`).
 */

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/youtube_index";

let postgresTestCounter = 0;
function uniqueChannelId(suffix: string): string {
  postgresTestCounter += 1;
  return `UC_INGEST_${process.pid}_${postgresTestCounter}_${suffix}`;
}

interface TestIds {
  channelId: string;
  videoA: string;
  videoB: string;
  commentId: string;
}

function makeTestIds(suffix: string): TestIds {
  const counter = `${process.pid}_${++postgresTestCounter}`;
  return {
    channelId: `UC_INGEST_${counter}_${suffix}`,
    videoA: `v_${counter}_a`,
    videoB: `v_${counter}_b`,
    commentId: `c_${counter}_a`,
  };
}

function makeYouTube(ids: TestIds): YouTubeClient {
  return {
    resolveHandle: async () => ({ channelId: ids.channelId, title: "Canal Postgres Ingest" }),
    getUploadsPlaylistId: async () => `UU_${ids.channelId}`,
    listUploads: async () => ({
      videos: [
        {
          id: ids.videoA,
          title: "Primeiro vídeo",
          description: "desc v1",
          publishedAt: "2023-01-01T00:00:00Z",
        },
        {
          id: ids.videoB,
          title: "Segundo vídeo",
          description: "desc v2",
          publishedAt: "2023-01-02T00:00:00Z",
        },
      ],
      nextPageToken: null,
    }),
    getVideoStats: async (videoId: string): Promise<YouTubeVideoStats> => {
      if (videoId === ids.videoA) {
        return { views: 100, likes: 10, durationSeconds: 120 };
      }
      return { views: 200, likes: 20, durationSeconds: 240 };
    },
    listComments: async (videoId: string): Promise<YouTubeComment[]> => {
      if (videoId === ids.videoA) {
        return [
          {
            id: ids.commentId,
            author: "Autor 1",
            text: "Comentário do v1",
            likes: 3,
            publishedAt: "2023-01-03T00:00:00Z",
          },
        ];
      }
      // Vídeo v2 simula `CommentsDisabledError` para exercitar
      // `markCommentAbsence` no PostgresLedger.
      throw new CommentsDisabledError(videoId);
    },
  };
}

function makeTranscripts(ids: TestIds): TranscriptFetcher {
  return {
    async fetchTranscript(videoId: string): Promise<TranscriptResult> {
      if (videoId === ids.videoA) {
        const transcript: Transcript = {
          videoId,
          segments: [
            { start: 0, duration: 5, text: "trecho 1 do v1" },
            { start: 5, duration: 5, text: "trecho 2 do v1" },
          ],
        };
        return { kind: "transcript", transcript };
      }
      return { kind: "absent" };
    },
  };
}

function makeProjection(): Projection {
  return {
    addDocuments: async () => undefined,
    remove: async () => undefined,
    clear: async () => undefined,
  };
}

describe("POSTGRES ingestion pipeline (slice #43)", () => {
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

  it("runJob ingere Vídeos, Comentários e Segmentos via PostgresLedger", async () => {
    const ids = makeTestIds("run");
    const ledger: Ledger = new PostgresLedger(pool);
    const ingestion: Ingestion = createIngestion({
      youtube: makeYouTube(ids),
      transcripts: makeTranscripts(ids),
      ledger,
      projection: makeProjection(),
    });
    createdChannelIds.push(ids.channelId);

    await ledger.createChannel({
      channelId: ids.channelId,
      handle: "@postgres-ingest",
      title: "Canal Postgres Ingest",
    });

    await ingestion.runJob(ids.channelId);

    // Canal termina em completed e todas as fases também
    const channel = await ledger.getChannel(ids.channelId);
    expect(channel?.status).toBe("completed");
    expect(channel?.phases).toMatchObject({
      videos: { status: "completed", done: 2, total: 2 },
      comments: { status: "completed", done: 2, total: 2 },
      transcripts: { status: "completed", done: 2, total: 2 },
    });

    // Vídeos persistidos
    const videos = await ledger.listVideos(ids.channelId);
    expect(videos).toHaveLength(2);
    expect(videos.map((v) => v.id).sort()).toEqual([ids.videoA, ids.videoB].sort());

    // Comentário do videoA persistido, ausência de videoB registrada
    const comments = await ledger.listComments(ids.channelId);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.id).toBe(ids.commentId);
    expect(await ledger.listCommentAbsences(ids.channelId)).toEqual([ids.videoB]);

    // Segmentos de videoA persistidos, ausência de videoB registrada
    const segments = await ledger.listTranscriptSegments(ids.channelId);
    expect(segments).toHaveLength(2);
    expect(segments.map((s) => s.start).sort()).toEqual([0, 5]);
    expect(await ledger.listTranscriptAbsences(ids.channelId)).toEqual([ids.videoB]);

    // Confirma via SQL direto que as linhas estão realmente no Postgres
    // (não no cache do Ledger).
    const videoRows = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM videos WHERE channel_id = $1",
      [ids.channelId],
    );
    expect(Number(videoRows.rows[0]?.count ?? "0")).toBe(2);

    const commentRows = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM comments c JOIN videos v ON v.id = c.video_id WHERE v.channel_id = $1",
      [ids.channelId],
    );
    expect(Number(commentRows.rows[0]?.count ?? "0")).toBe(1);

    const segmentRows = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM transcript_segments t JOIN videos v ON v.id = t.video_id WHERE v.channel_id = $1",
      [ids.channelId],
    );
    expect(Number(segmentRows.rows[0]?.count ?? "0")).toBe(2);

    const absenceCommentRows = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM comment_absences a JOIN videos v ON v.id = a.video_id WHERE v.channel_id = $1",
      [ids.channelId],
    );
    expect(Number(absenceCommentRows.rows[0]?.count ?? "0")).toBe(1);

    const absenceTranscriptRows = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM transcript_absences a JOIN videos v ON v.id = a.video_id WHERE v.channel_id = $1",
      [ids.channelId],
    );
    expect(Number(absenceTranscriptRows.rows[0]?.count ?? "0")).toBe(1);
  });

  it("deleteChannel em cascata apaga Vídeos, Comentários, Segmentos e ausências", async () => {
    const ids = makeTestIds("cascade");
    const ledger: Ledger = new PostgresLedger(pool);
    const ingestion: Ingestion = createIngestion({
      youtube: makeYouTube(ids),
      transcripts: makeTranscripts(ids),
      ledger,
      projection: makeProjection(),
    });
    createdChannelIds.push(ids.channelId);

    await ledger.createChannel({
      channelId: ids.channelId,
      handle: "@postgres-ingest",
      title: "Canal Postgres Ingest",
    });
    await ingestion.runJob(ids.channelId);

    await ledger.deleteChannel(ids.channelId);

    expect(await ledger.getChannel(ids.channelId)).toBeNull();
    expect(await ledger.listVideos(ids.channelId)).toEqual([]);
    expect(await ledger.listComments(ids.channelId)).toEqual([]);
    expect(await ledger.listTranscriptSegments(ids.channelId)).toEqual([]);
    expect(await ledger.listCommentAbsences(ids.channelId)).toEqual([]);
    expect(await ledger.listTranscriptAbsences(ids.channelId)).toEqual([]);

    // Confirma via SQL direto que o cascade varreu todas as tabelas
    const counts = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM videos WHERE channel_id = $1`,
      [ids.channelId],
    );
    expect(Number(counts.rows[0]?.count ?? "0")).toBe(0);
  });
});