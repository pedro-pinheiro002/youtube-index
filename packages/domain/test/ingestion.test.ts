import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/schema.js";
import { SqliteLedger } from "../src/ledger.js";
import { createIngestion } from "../src/ingestion.js";
import { CommentsDisabledError, YouTubeApiError } from "../src/youtube.js";
import type {
  Documento,
  Ledger,
  Projection,
  ProjectionHit,
  Transcript,
  TranscriptFetcher,
  YouTubeClient,
  YouTubeComment,
  YouTubeVideo,
  YouTubeVideoStats,
} from "../src/index.js";

const CHANNEL_ID = "UCY8iijN1AkyDCh1Z9akcqUA";
const UPLOADS_PLAYLIST_ID = "UUPL-funky";

interface FakePage {
  videos: YouTubeVideo[];
  nextPageToken: string | null;
}

interface ClientRecorder {
  statsCalls?: string[];
  listUploadsCalls?: Array<string | null>;
  commentsCalls?: string[];
}

function makeLedger(): Ledger {
  return new SqliteLedger(createDatabase(":memory:"));
}

function makeTranscriptFetcher(): TranscriptFetcher {
  return { fetchTranscript: async () => null };
}

function makeTranscriptFetcherWith(transcripts: Record<string, Transcript | null>): TranscriptFetcher {
  return { fetchTranscript: async (videoId) => transcripts[videoId] ?? null };
}

function makeRecordingTranscriptFetcher(transcripts: Record<string, Transcript | null>) {
  const calls: string[] = [];
  return {
    calls,
    fetcher: {
      fetchTranscript: async (videoId: string) => {
        calls.push(videoId);
        return transcripts[videoId] ?? null;
      },
    } satisfies TranscriptFetcher,
  };
}

function makeProjection(): Projection {
  return { addDocuments: async () => {}, remove: async () => {}, clear: async () => {} };
}

function makeRecordingProjection() {
  const calls: Array<{ channelId: string; documents: Documento[] }> = [];
  const removeCalls: Array<{ channelId: string; predicate: (hit: ProjectionHit) => boolean }> = [];
  const clearCalls: string[] = [];
  const projection = {
    addDocuments: async (channelId: string, documents: Documento[]) => {
      calls.push({ channelId, documents });
    },
    remove: async (channelId: string, predicate: (hit: ProjectionHit) => boolean) => {
      removeCalls.push({ channelId, predicate });
    },
    clear: async (channelId: string) => {
      clearCalls.push(channelId);
    },
    calls,
    removeCalls,
    clearCalls,
  };
  return projection;
}

function makeYouTubeClient(
  pages: FakePage[],
  stats: Record<string, YouTubeVideoStats>,
  comments: Record<string, YouTubeComment[] | Error> = {},
  recorder: ClientRecorder = {},
): YouTubeClient {
  const byToken = new Map<string | null, FakePage>();
  for (let i = 0; i < pages.length; i++) {
    byToken.set(i === 0 ? null : pages[i - 1]!.nextPageToken, pages[i]!);
  }
  return {
    resolveHandle: async () => ({ channelId: CHANNEL_ID, title: "Funky Black Cat" }),
    getUploadsPlaylistId: async () => UPLOADS_PLAYLIST_ID,
    listUploads: async (_playlistId, pageToken) => {
      recorder.listUploadsCalls?.push(pageToken ?? null);
      const page = byToken.get(pageToken ?? null);
      if (!page) throw new Error(`página inesperada: ${pageToken}`);
      return page;
    },
    getVideoStats: async (videoId) => {
      recorder.statsCalls?.push(videoId);
      return stats[videoId] ?? null;
    },
    listComments: async (videoId) => {
      recorder.commentsCalls?.push(videoId);
      const entry = comments[videoId];
      if (entry instanceof Error) {
        throw entry;
      }
      return entry ?? [];
    },
  };
}

function makeIngestion(youtube: YouTubeClient, ledger: Ledger) {
  return createIngestion({
    youtube,
    transcripts: makeTranscriptFetcher(),
    ledger,
    projection: makeProjection(),
  });
}

function video(id: string, title: string, publishedAt: string): YouTubeVideo {
  return { id, title, description: `descrição de ${id}`, publishedAt };
}

describe("createIngestion", () => {
  describe("runVideosPhase", () => {
    it("roda a Fase de Vídeos contra o YouTubeClient fake e grava os Vídeos no Ledger", async () => {
      const ledger = makeLedger();
      ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
      const ingestion = makeIngestion(
        makeYouTubeClient(
          [
            {
              videos: [
                video("v1", "Primeiro vídeo", "2023-01-01T00:00:00Z"),
                video("v2", "Segundo vídeo", "2023-01-02T00:00:00Z"),
              ],
              nextPageToken: null,
            },
          ],
          { v1: { views: 100, likes: 10, durationSeconds: 120 }, v2: { views: 200, likes: 20, durationSeconds: 240 } },
        ),
        ledger,
      );

      await ingestion.runVideosPhase(CHANNEL_ID);

      const channel = ledger.getChannel(CHANNEL_ID);
      expect(channel?.phases.videos).toMatchObject({ status: "completed", done: 2, total: 2 });

      const stored = ledger.listVideos(CHANNEL_ID);
      expect(stored).toHaveLength(2);
      expect(stored).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "v1", title: "Primeiro vídeo", views: 100, likes: 10, durationSeconds: 120 }),
          expect.objectContaining({ id: "v2", title: "Segundo vídeo", views: 200, likes: 20, durationSeconds: 240 }),
        ]),
      );
    });

    it("captura métricas (views, likes, duração) via videos.list", async () => {
      const ledger = makeLedger();
      ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
      const ingestion = makeIngestion(
        makeYouTubeClient(
          [{ videos: [video("v1", "Métricas", "2023-01-01T00:00:00Z")], nextPageToken: null }],
          { v1: { views: 1234, likes: 56, durationSeconds: 542 } },
        ),
        ledger,
      );

      await ingestion.runVideosPhase(CHANNEL_ID);

      const stored = ledger.listVideos(CHANNEL_ID);
      expect(stored).toEqual([
        expect.objectContaining({ id: "v1", views: 1234, likes: 56, durationSeconds: 542 }),
      ]);
    });

    it("percorre a playlist de uploads página a página até esgotar", async () => {
      const ledger = makeLedger();
      ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
      const ingestion = makeIngestion(
        makeYouTubeClient(
          [
            { videos: [video("v1", "Página 1", "2023-01-01T00:00:00Z")], nextPageToken: "2" },
            { videos: [video("v2", "Página 2", "2023-01-02T00:00:00Z")], nextPageToken: null },
          ],
          {
            v1: { views: 1, likes: 0, durationSeconds: 10 },
            v2: { views: 2, likes: 0, durationSeconds: 20 },
          },
        ),
        ledger,
      );

      await ingestion.runVideosPhase(CHANNEL_ID);

      const channel = ledger.getChannel(CHANNEL_ID);
      expect(channel?.phases.videos).toMatchObject({ status: "completed", done: 2, total: 2 });
      expect(ledger.listVideos(CHANNEL_ID).map((v) => v.id)).toEqual(["v2", "v1"]);
    });

    it("não duplica Vídeos quando re-executado (dedupe por id)", async () => {
      const ledger = makeLedger();
      ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
      const ingestion = makeIngestion(
        makeYouTubeClient(
          [{ videos: [video("v1", "Repetido", "2023-01-01T00:00:00Z")], nextPageToken: null }],
          { v1: { views: 1, likes: 0, durationSeconds: 10 } },
        ),
        ledger,
      );

      await ingestion.runVideosPhase(CHANNEL_ID);
      await ingestion.runVideosPhase(CHANNEL_ID);

      expect(ledger.listVideos(CHANNEL_ID)).toHaveLength(1);
    });

    it("pula Vídeos sem métricas (removidos/indisponíveis) sem derrubar a Fase", async () => {
      const ledger = makeLedger();
      ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
      const ingestion = makeIngestion(
        makeYouTubeClient(
          [
            {
              videos: [
                video("v1", "Removido", "2023-01-01T00:00:00Z"),
                video("v2", "Disponível", "2023-01-02T00:00:00Z"),
              ],
              nextPageToken: null,
            },
          ],
          { v2: { views: 200, likes: 20, durationSeconds: 240 } },
        ),
        ledger,
      );

      await ingestion.runVideosPhase(CHANNEL_ID);

      expect(ledger.listVideos(CHANNEL_ID).map((v) => v.id)).toEqual(["v2"]);
      expect(ledger.getChannel(CHANNEL_ID)?.phases.videos).toMatchObject({
        status: "completed",
        done: 2,
        // total = Vídeos no Ledger (v1 foi pulado por não ter métricas)
        total: 1,
      });
    });

    it("grava Documentos de Vídeo na Projeção com contexto denormalizado (URL e thumbnail)", async () => {
      const ledger = makeLedger();
      ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
      const projection = makeRecordingProjection();
      const ingestion = createIngestion({
        youtube: makeYouTubeClient(
          [{ videos: [video("v1", "Primeiro vídeo", "2023-01-01T00:00:00Z")], nextPageToken: null }],
          { v1: { views: 1234, likes: 56, durationSeconds: 542 } },
        ),
        transcripts: makeTranscriptFetcher(),
        ledger,
        projection,
      });

      await ingestion.runVideosPhase(CHANNEL_ID);

      expect(projection.calls).toEqual([
        {
          channelId: CHANNEL_ID,
          documents: [
            expect.objectContaining({
              id: "v1",
              channelId: CHANNEL_ID,
              type: "video",
              title: "Primeiro vídeo",
              description: "descrição de v1",
              views: 1234,
              likes: 56,
              durationSeconds: 542,
              url: "https://www.youtube.com/watch?v=v1",
              thumbnail: "https://i.ytimg.com/vi/v1/hqdefault.jpg",
              publishedAt: "2023-01-01T00:00:00Z",
            }),
          ],
        },
      ]);
    });
  });

  describe("runCommentsPhase", () => {
    function makeChannelWithVideos(): { ledger: Ledger; ingestion: ReturnType<typeof makeIngestion> } {
      const ledger = makeLedger();
      ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
      const ingestion = makeIngestion(
        makeYouTubeClient(
          [
            {
              videos: [
                video("v1", "Primeiro vídeo", "2023-01-01T00:00:00Z"),
                video("v2", "Segundo vídeo", "2023-01-02T00:00:00Z"),
              ],
              nextPageToken: null,
            },
          ],
          { v1: { views: 100, likes: 10, durationSeconds: 120 }, v2: { views: 200, likes: 20, durationSeconds: 240 } },
        ),
        ledger,
      );
      return { ledger, ingestion };
    }

    it("busca Comentários por Vídeo e os grava no Ledger como linhas canônicas", async () => {
      const { ledger, ingestion } = makeChannelWithVideos();
      await ingestion.runVideosPhase(CHANNEL_ID);
      const youtube = makeYouTubeClient([], {}, {
        v1: [{ id: "c1", author: "Gato Funky", text: "Primeiro comentário", likes: 42, publishedAt: "2023-01-02T00:00:00Z" }],
        v2: [{ id: "c2", author: "Cão Legal", text: "Segundo comentário", likes: 7, publishedAt: "2023-01-03T00:00:00Z" }],
      });
      const ingestionComments = createIngestion({ youtube, transcripts: makeTranscriptFetcher(), ledger, projection: makeProjection() });

      await ingestionComments.runCommentsPhase(CHANNEL_ID);

      const stored = ledger.listComments(CHANNEL_ID);
      expect(stored).toHaveLength(2);
      expect(stored).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "c1",
            videoId: "v1",
            channelId: CHANNEL_ID,
            author: "Gato Funky",
            text: "Primeiro comentário",
            likes: 42,
          }),
          expect.objectContaining({
            id: "c2",
            videoId: "v2",
            author: "Cão Legal",
          }),
        ]),
      );
      expect(ledger.getChannel(CHANNEL_ID)?.phases.comments).toMatchObject({
        status: "completed",
        done: 2,
        total: 2,
      });
    });

    it("projeta Documentos de Comentário com contexto denormalizado do Vídeo", async () => {
      const { ledger, ingestion } = makeChannelWithVideos();
      await ingestion.runVideosPhase(CHANNEL_ID);
      const projection = makeRecordingProjection();
      const youtube = makeYouTubeClient([], {}, {
        v1: [{ id: "c1", author: "Gato Funky", text: "Primeiro comentário", likes: 42, publishedAt: "2023-01-02T00:00:00Z" }],
      });
      const ingestionComments = createIngestion({ youtube, transcripts: makeTranscriptFetcher(), ledger, projection });

      await ingestionComments.runCommentsPhase(CHANNEL_ID);

      expect(projection.calls).toEqual([
        {
          channelId: CHANNEL_ID,
          documents: [
            expect.objectContaining({
              id: "c1",
              channelId: CHANNEL_ID,
              type: "comment",
              videoId: "v1",
              videoTitle: "Primeiro vídeo",
              videoUrl: "https://www.youtube.com/watch?v=v1",
              videoThumbnail: "https://i.ytimg.com/vi/v1/hqdefault.jpg",
              author: "Gato Funky",
              text: "Primeiro comentário",
              likes: 42,
            }),
          ],
        },
      ]);
    });

    it("pula Vídeos com Comentários desativados sem derrubar a Fase", async () => {
      const { ledger, ingestion } = makeChannelWithVideos();
      await ingestion.runVideosPhase(CHANNEL_ID);
      const projection = makeRecordingProjection();
      const youtube = makeYouTubeClient([], {}, {
        v1: new CommentsDisabledError("v1"),
        v2: [{ id: "c2", author: "Cão Legal", text: "Segundo comentário", likes: 7, publishedAt: "2023-01-03T00:00:00Z" }],
      });
      const ingestionComments = createIngestion({ youtube, transcripts: makeTranscriptFetcher(), ledger, projection });

      await ingestionComments.runCommentsPhase(CHANNEL_ID);

      const stored = ledger.listComments(CHANNEL_ID);
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ id: "c2" });
      expect(ledger.getChannel(CHANNEL_ID)?.phases.comments).toMatchObject({
        status: "completed",
        done: 2,
        total: 2,
      });
    });

    it("conclui a Fase quando nenhum Vídeo tem Comentários", async () => {
      const { ledger, ingestion } = makeChannelWithVideos();
      await ingestion.runVideosPhase(CHANNEL_ID);
      const projection = makeRecordingProjection();
      const ingestionComments = createIngestion({
        youtube: makeYouTubeClient([], {}),
        transcripts: makeTranscriptFetcher(),
        ledger,
        projection,
      });

      await ingestionComments.runCommentsPhase(CHANNEL_ID);

      expect(ledger.listComments(CHANNEL_ID)).toEqual([]);
      expect(ledger.getChannel(CHANNEL_ID)?.phases.comments).toMatchObject({
        status: "completed",
        done: 2,
        total: 2,
      });
    });
  });

  describe("runTranscriptsPhase", () => {
    function makeChannelWithVideos(): { ledger: Ledger; ingestion: ReturnType<typeof makeIngestion> } {
      const ledger = makeLedger();
      ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
      const ingestion = makeIngestion(
        makeYouTubeClient(
          [
            {
              videos: [
                video("v1", "Primeiro vídeo", "2023-01-01T00:00:00Z"),
                video("v2", "Segundo vídeo", "2023-01-02T00:00:00Z"),
              ],
              nextPageToken: null,
            },
          ],
          { v1: { views: 100, likes: 10, durationSeconds: 120 }, v2: { views: 200, likes: 20, durationSeconds: 240 } },
        ),
        ledger,
      );
      return { ledger, ingestion };
    }

    it("busca Transcrições pelo TranscriptFetcher e grava os Segmentos no Ledger com timestamp", async () => {
      const { ledger, ingestion } = makeChannelWithVideos();
      await ingestion.runVideosPhase(CHANNEL_ID);
      const fetcher = makeTranscriptFetcherWith({
        v1: {
          videoId: "v1",
          segments: [
            { start: 0, duration: 10, text: "primeiro trecho" },
            { start: 142, duration: 8, text: "trecho com deep-link" },
          ],
        },
        v2: null,
      });
      const ingestionTranscripts = createIngestion({
        youtube: makeYouTubeClient([], {}),
        transcripts: fetcher,
        ledger,
        projection: makeProjection(),
      });

      await ingestionTranscripts.runTranscriptsPhase(CHANNEL_ID);

      const segments = ledger.listTranscriptSegments(CHANNEL_ID);
      expect(segments).toEqual([
        expect.objectContaining({
          id: "v1:0",
          videoId: "v1",
          channelId: CHANNEL_ID,
          start: 0,
          end: 10,
          text: "primeiro trecho",
        }),
        expect.objectContaining({
          id: "v1:142",
          videoId: "v1",
          channelId: CHANNEL_ID,
          start: 142,
          end: 150,
          text: "trecho com deep-link",
        }),
      ]);
      expect(ledger.getChannel(CHANNEL_ID)?.phases.transcripts).toMatchObject({
        status: "completed",
        done: 2,
        total: 2,
      });
    });

    it("projeta Documentos de Segmento com deep-link ao momento exato", async () => {
      const { ledger, ingestion } = makeChannelWithVideos();
      await ingestion.runVideosPhase(CHANNEL_ID);
      const projection = makeRecordingProjection();
      const fetcher = makeTranscriptFetcherWith({
        v1: { videoId: "v1", segments: [{ start: 142, duration: 8, text: "trecho com deep-link" }] },
      });
      const ingestionTranscripts = createIngestion({
        youtube: makeYouTubeClient([], {}),
        transcripts: fetcher,
        ledger,
        projection,
      });

      await ingestionTranscripts.runTranscriptsPhase(CHANNEL_ID);

      expect(projection.calls).toEqual([
        {
          channelId: CHANNEL_ID,
          documents: [
            expect.objectContaining({
              id: "v1:142",
              channelId: CHANNEL_ID,
              type: "segment",
              videoId: "v1",
              videoTitle: "Primeiro vídeo",
              videoUrl: "https://www.youtube.com/watch?v=v1",
              videoThumbnail: "https://i.ytimg.com/vi/v1/hqdefault.jpg",
              text: "trecho com deep-link",
              start: 142,
              end: 150,
              url: "https://www.youtube.com/watch?v=v1&t=142s",
              publishedAt: "2023-01-01T00:00:00Z",
            }),
          ],
        },
      ]);
    });

    it("marca Vídeos sem Transcrição no Ledger e não derruba a Fase", async () => {
      const { ledger, ingestion } = makeChannelWithVideos();
      await ingestion.runVideosPhase(CHANNEL_ID);
      const fetcher = makeTranscriptFetcherWith({
        v1: { videoId: "v1", segments: [{ start: 0, duration: 10, text: "único trecho" }] },
        v2: null,
      });
      const ingestionTranscripts = createIngestion({
        youtube: makeYouTubeClient([], {}),
        transcripts: fetcher,
        ledger,
        projection: makeProjection(),
      });

      await ingestionTranscripts.runTranscriptsPhase(CHANNEL_ID);

      expect(ledger.listTranscriptAbsences(CHANNEL_ID)).toEqual(["v2"]);
      expect(ledger.listTranscriptSegments(CHANNEL_ID)).toHaveLength(1);
      expect(ledger.getChannel(CHANNEL_ID)?.phases.transcripts).toMatchObject({
        status: "completed",
        done: 2,
        total: 2,
      });
    });

    it("conclui a Fase quando nenhum Vídeo tem Transcrição", async () => {
      const { ledger, ingestion } = makeChannelWithVideos();
      await ingestion.runVideosPhase(CHANNEL_ID);
      const ingestionTranscripts = createIngestion({
        youtube: makeYouTubeClient([], {}),
        transcripts: makeTranscriptFetcher(),
        ledger,
        projection: makeProjection(),
      });

      await ingestionTranscripts.runTranscriptsPhase(CHANNEL_ID);

      expect(ledger.listTranscriptSegments(CHANNEL_ID)).toEqual([]);
      expect(ledger.listTranscriptAbsences(CHANNEL_ID)).toEqual(["v1", "v2"]);
      expect(ledger.getChannel(CHANNEL_ID)?.phases.transcripts).toMatchObject({
        status: "completed",
        done: 2,
        total: 2,
      });
    });
  });

  describe("runJob", () => {
    it("marca o Canal como ingesting durante a Fase e completed ao final", async () => {
      const ledger = makeLedger();
      ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
      const ingestion = makeIngestion(
        makeYouTubeClient(
          [{ videos: [video("v1", "Um vídeo", "2023-01-01T00:00:00Z")], nextPageToken: null }],
          { v1: { views: 1, likes: 0, durationSeconds: 10 } },
        ),
        ledger,
      );

      await ingestion.runJob(CHANNEL_ID);

      const channel = ledger.getChannel(CHANNEL_ID);
      expect(channel?.status).toBe("completed");
      expect(channel?.phases.videos).toMatchObject({ status: "completed", done: 1, total: 1 });
    });

    it("marca o Canal como completed ao final e roda também a Fase de Comentários", async () => {
      const ledger = makeLedger();
      ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
      const projection = makeRecordingProjection();
      const ingestion = createIngestion({
        youtube: makeYouTubeClient(
          [{ videos: [video("v1", "Um vídeo", "2023-01-01T00:00:00Z")], nextPageToken: null }],
          { v1: { views: 1, likes: 0, durationSeconds: 10 } },
          { v1: [{ id: "c1", author: "Gato Funky", text: "Primeiro comentário", likes: 5, publishedAt: "2023-01-02T00:00:00Z" }] },
        ),
        transcripts: makeTranscriptFetcher(),
        ledger,
        projection,
      });

      await ingestion.runJob(CHANNEL_ID);

      const channel = ledger.getChannel(CHANNEL_ID);
      expect(channel?.status).toBe("completed");
      expect(channel?.phases.videos).toMatchObject({ status: "completed", done: 1, total: 1 });
      expect(channel?.phases.comments).toMatchObject({ status: "completed", done: 1, total: 1 });
      expect(channel?.phases.transcripts).toMatchObject({ status: "completed", done: 1, total: 1 });
      expect(ledger.listComments(CHANNEL_ID)).toHaveLength(1);
      expect(projection.calls.flatMap((c) => c.documents.map((d) => d.type))).toEqual(["video", "comment"]);
    });

    it("roda as três Fases e projeta Segmentos com deep-link", async () => {
      const ledger = makeLedger();
      ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
      const projection = makeRecordingProjection();
      const ingestion = createIngestion({
        youtube: makeYouTubeClient(
          [{ videos: [video("v1", "Um vídeo", "2023-01-01T00:00:00Z")], nextPageToken: null }],
          { v1: { views: 1, likes: 0, durationSeconds: 10 } },
        ),
        transcripts: makeTranscriptFetcherWith({
          v1: { videoId: "v1", segments: [{ start: 142, duration: 8, text: "trecho com deep-link" }] },
        }),
        ledger,
        projection,
      });

      await ingestion.runJob(CHANNEL_ID);

      const channel = ledger.getChannel(CHANNEL_ID);
      expect(channel?.status).toBe("completed");
      expect(channel?.phases.videos).toMatchObject({ status: "completed" });
      expect(channel?.phases.comments).toMatchObject({ status: "completed" });
      expect(channel?.phases.transcripts).toMatchObject({ status: "completed", done: 1, total: 1 });
      const segmentDocs = projection.calls.flatMap((c) => c.documents).filter((d) => d.type === "segment");
      expect(segmentDocs).toEqual([
        expect.objectContaining({
          id: "v1:142",
          type: "segment",
          url: "https://www.youtube.com/watch?v=v1&t=142s",
        }),
      ]);
    });

    it("marca o Canal como failed quando a Fase de Vídeos falha", async () => {
      const ledger = makeLedger();
      ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
      const failingYoutube: YouTubeClient = {
        resolveHandle: async () => ({ channelId: CHANNEL_ID, title: "Funky Black Cat" }),
        getUploadsPlaylistId: async () => {
          throw new Error("cota esgotada");
        },
        listUploads: async () => {
          throw new Error("não deve chegar aqui");
        },
        getVideoStats: async () => {
          throw new Error("não deve chegar aqui");
        },
        listComments: async () => {
          throw new Error("não deve chegar aqui");
        },
      };
      const ingestion = makeIngestion(failingYoutube, ledger);

      await expect(ingestion.runJob(CHANNEL_ID)).rejects.toThrow("cota esgotada");

      const channel = ledger.getChannel(CHANNEL_ID);
      expect(channel?.status).toBe("failed");
      expect(channel?.phases.videos.status).toBe("failed");
      expect(channel?.lastError).toBe("cota esgotada");
    });

    it("registra eventos estruturados de cada Fase na ordem de execução", async () => {
      const ledger = makeLedger();
      ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];
      const logger = {
        info: () => {},
        warn: () => {},
        error: () => {},
        event: (event: string, data: Record<string, unknown>) => {
          events.push({ event, data });
        },
      };
      const ingestion = createIngestion({
        youtube: makeYouTubeClient(
          [
            {
              videos: [
                video("v1", "Primeiro vídeo", "2023-01-01T00:00:00Z"),
                video("v2", "Segundo vídeo", "2023-01-02T00:00:00Z"),
                video("v3", "Sem métricas", "2023-01-03T00:00:00Z"),
              ],
              nextPageToken: null,
            },
          ],
          { v1: { views: 100, likes: 10, durationSeconds: 120 }, v2: { views: 200, likes: 20, durationSeconds: 240 } },
        ),
        transcripts: makeTranscriptFetcher(),
        ledger,
        projection: makeProjection(),
        logger,
      });

      await ingestion.runJob(CHANNEL_ID);

      expect(events).toEqual([
        { event: "phase:started", data: { phase: "videos", channelId: CHANNEL_ID } },
        { event: "video:processed", data: { phase: "videos", channelId: CHANNEL_ID, videoId: "v1" } },
        { event: "video:processed", data: { phase: "videos", channelId: CHANNEL_ID, videoId: "v2" } },
        { event: "video:skipped", data: { phase: "videos", channelId: CHANNEL_ID, videoId: "v3", reason: "no-metrics" } },
        { event: "video:processed", data: { phase: "videos", channelId: CHANNEL_ID, videoId: "v3" } },
        { event: "phase:completed", data: { phase: "videos", channelId: CHANNEL_ID, total: 2 } },
        { event: "phase:started", data: { phase: "comments", channelId: CHANNEL_ID } },
        { event: "video:processed", data: { phase: "comments", channelId: CHANNEL_ID, videoId: "v2" } },
        { event: "video:processed", data: { phase: "comments", channelId: CHANNEL_ID, videoId: "v1" } },
        { event: "phase:completed", data: { phase: "comments", channelId: CHANNEL_ID, total: 2 } },
        { event: "phase:started", data: { phase: "transcripts", channelId: CHANNEL_ID } },
        { event: "video:processed", data: { phase: "transcripts", channelId: CHANNEL_ID, videoId: "v2" } },
        { event: "video:processed", data: { phase: "transcripts", channelId: CHANNEL_ID, videoId: "v1" } },
        { event: "phase:completed", data: { phase: "transcripts", channelId: CHANNEL_ID, total: 2 } },
      ]);
    });
  });

  describe("Sincronização e resume guiados pelo Ledger", () => {
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

    function makeChannel(ledger: Ledger): void {
      ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
    }

    describe("runVideosPhase em Sincronização", () => {
      it("para no primeiro Vídeo já conhecido e não re-busca métricas de Vídeos ingeridos", async () => {
        const ledger = makeLedger();
        makeChannel(ledger);
        const first = makeIngestion(
          makeYouTubeClient([{ videos: [video("v1", "Antigo", daysAgo(200))], nextPageToken: null }], {
            v1: { views: 1, likes: 0, durationSeconds: 10 },
          }),
          ledger,
        );
        await first.runVideosPhase(CHANNEL_ID);

        const statsCalls: string[] = [];
        const listUploadsCalls: Array<string | null> = [];
        const second = makeIngestion(
          makeYouTubeClient(
            [
              {
                videos: [video("v3", "Novo", daysAgo(1)), video("v1", "Antigo", daysAgo(200))],
                nextPageToken: null,
              },
            ],
            { v3: { views: 300, likes: 30, durationSeconds: 300 } },
            {},
            { statsCalls, listUploadsCalls },
          ),
          ledger,
        );

        await second.runVideosPhase(CHANNEL_ID);

        expect(statsCalls).toEqual(["v3"]);
        expect(listUploadsCalls).toEqual([null]);
        expect(ledger.listVideos(CHANNEL_ID).map((v) => v.id).sort()).toEqual(["v1", "v3"]);
      });

      it("no resume após falha, percorre a playlist sem re-buscar métricas de Vídeos já ingeridos", async () => {
        const ledger = makeLedger();
        makeChannel(ledger);
        ledger.upsertVideo({
          id: "v1",
          channelId: CHANNEL_ID,
          title: "Antigo",
          description: "desc",
          publishedAt: daysAgo(200),
          views: 1,
          likes: 0,
          durationSeconds: 10,
        });
        ledger.upsertVideo({
          id: "v2",
          channelId: CHANNEL_ID,
          title: "Antigo",
          description: "desc",
          publishedAt: daysAgo(180),
          views: 2,
          likes: 0,
          durationSeconds: 20,
        });
        ledger.updatePhase(CHANNEL_ID, "videos", { status: "failed" });

        const statsCalls: string[] = [];
        const ingestion = makeIngestion(
          makeYouTubeClient(
            [
              {
                videos: [video("v1", "Antigo", daysAgo(200)), video("v2", "Antigo", daysAgo(180)), video("v3", "Novo", daysAgo(1))],
                nextPageToken: null,
              },
            ],
            { v3: { views: 300, likes: 30, durationSeconds: 300 } },
            {},
            { statsCalls },
          ),
          ledger,
        );

        await ingestion.runVideosPhase(CHANNEL_ID);

        expect(statsCalls).toEqual(["v3"]);
        expect(ledger.listVideos(CHANNEL_ID).map((v) => v.id)).toEqual(["v3", "v2", "v1"]);
        expect(ledger.getChannel(CHANNEL_ID)?.phases.videos).toMatchObject({ status: "completed", done: 3, total: 3 });
      });
    });

    describe("runCommentsPhase em resume", () => {
      function makeChannelWithVideos(ledger: Ledger): void {
        makeChannel(ledger);
        for (const [id, days] of [
          ["v1", 10],
          ["v2", 20],
          ["v3", 30],
          ["v4", 40],
        ] as const) {
          ledger.upsertVideo({
            id,
            channelId: CHANNEL_ID,
            title: `Vídeo ${id}`,
            description: "desc",
            publishedAt: daysAgo(days),
            views: 1,
            likes: 0,
            durationSeconds: 10,
          });
        }
      }

      it("pula Vídeos já ingeridos (com Comentários ou ausência marcada) e processa só o pendente", async () => {
        const ledger = makeLedger();
        makeChannelWithVideos(ledger);
        ledger.upsertComment({
          id: "c1",
          videoId: "v1",
          channelId: CHANNEL_ID,
          author: "Gato Funky",
          text: "Comentário de v1",
          likes: 1,
          publishedAt: daysAgo(5),
        });
        ledger.markCommentAbsence("v3", "disabled");
        ledger.updatePhase(CHANNEL_ID, "comments", { status: "failed" });

        const commentsCalls: string[] = [];
        const ingestion = createIngestion({
          youtube: makeYouTubeClient(
            [],
            {},
            {
              v2: [{ id: "c2", author: "A", text: "Comentário de v2", likes: 2, publishedAt: daysAgo(4) }],
              v4: [{ id: "c4", author: "B", text: "Comentário de v4", likes: 4, publishedAt: daysAgo(2) }],
            },
            { commentsCalls },
          ),
          transcripts: makeTranscriptFetcher(),
          ledger,
          projection: makeProjection(),
        });

        await ingestion.runCommentsPhase(CHANNEL_ID);

        expect(commentsCalls).toEqual(["v2", "v4"]);
        expect(ledger.listComments(CHANNEL_ID).map((c) => c.id).sort()).toEqual(["c1", "c2", "c4"]);
        expect(ledger.listCommentAbsences(CHANNEL_ID)).toEqual(["v3"]);
        expect(ledger.getChannel(CHANNEL_ID)?.phases.comments).toMatchObject({ status: "completed", done: 4, total: 4 });
      });

      it("na Sincronização re-busca apenas Comentários de Vídeos recentes e substitui os antigos", async () => {
        const ledger = makeLedger();
        makeChannel(ledger);
        ledger.upsertVideo({
          id: "v1",
          channelId: CHANNEL_ID,
          title: "Recente",
          description: "desc",
          publishedAt: daysAgo(10),
          views: 1,
          likes: 0,
          durationSeconds: 10,
        });
        ledger.upsertVideo({
          id: "v2",
          channelId: CHANNEL_ID,
          title: "Antigo",
          description: "desc",
          publishedAt: daysAgo(365),
          views: 2,
          likes: 0,
          durationSeconds: 20,
        });
        ledger.upsertComment({
          id: "c1",
          videoId: "v1",
          channelId: CHANNEL_ID,
          author: "Antigo Autor",
          text: "Comentário antigo de v1",
          likes: 1,
          publishedAt: daysAgo(5),
        });
        ledger.upsertComment({
          id: "c2",
          videoId: "v2",
          channelId: CHANNEL_ID,
          author: "Autor",
          text: "Comentário de v2",
          likes: 2,
          publishedAt: daysAgo(300),
        });
        ledger.updatePhase(CHANNEL_ID, "comments", { status: "completed" });

        const commentsCalls: string[] = [];
        const ingestion = createIngestion({
          youtube: makeYouTubeClient(
            [],
            {},
            {
              v1: [
                { id: "c1", author: "Novo Autor", text: "Comentário atualizado", likes: 10, publishedAt: daysAgo(1) },
                { id: "c1b", author: "Outro", text: "Comentário novo", likes: 5, publishedAt: daysAgo(1) },
              ],
            },
            { commentsCalls },
          ),
          transcripts: makeTranscriptFetcher(),
          ledger,
          projection: makeProjection(),
        });

        await ingestion.runCommentsPhase(CHANNEL_ID);

        expect(commentsCalls).toEqual(["v1"]);
        const comments = ledger.listComments(CHANNEL_ID);
        expect(comments.find((c) => c.id === "c1")).toMatchObject({ text: "Comentário atualizado", author: "Novo Autor" });
        expect(comments.map((c) => c.id).sort()).toEqual(["c1", "c1b", "c2"]);
      });

      it("respeita a janela de recência configurável na Sincronização", async () => {
        const ledger = makeLedger();
        makeChannel(ledger);
        for (const [id, days] of [
          ["v1", 3],
          ["v2", 10],
        ] as const) {
          ledger.upsertVideo({
            id,
            channelId: CHANNEL_ID,
            title: `Vídeo ${id}`,
            description: "desc",
            publishedAt: daysAgo(days),
            views: 1,
            likes: 0,
            durationSeconds: 10,
          });
        }
        ledger.updatePhase(CHANNEL_ID, "comments", { status: "completed" });

        const commentsCalls: string[] = [];
        const ingestion = createIngestion({
          youtube: makeYouTubeClient([], {}, {}, { commentsCalls }),
          transcripts: makeTranscriptFetcher(),
          ledger,
          projection: makeProjection(),
          recentWindowDays: 5,
        });

        await ingestion.runCommentsPhase(CHANNEL_ID);

        expect(commentsCalls).toEqual(["v1"]);
      });

      it("marca Vídeos com Comentários desativados e vazios como ausência no Ledger", async () => {
        const ledger = makeLedger();
        makeChannel(ledger);
        for (const [id, days] of [
          ["v1", 10],
          ["v2", 20],
        ] as const) {
          ledger.upsertVideo({
            id,
            channelId: CHANNEL_ID,
            title: `Vídeo ${id}`,
            description: "desc",
            publishedAt: daysAgo(days),
            views: 1,
            likes: 0,
            durationSeconds: 10,
          });
        }
        const ingestion = createIngestion({
          youtube: makeYouTubeClient([], {}, {
            v1: new CommentsDisabledError("v1"),
            v2: [],
          }),
          transcripts: makeTranscriptFetcher(),
          ledger,
          projection: makeProjection(),
        });

        await ingestion.runCommentsPhase(CHANNEL_ID);

        expect(ledger.listCommentAbsences(CHANNEL_ID)).toEqual(["v1", "v2"]);
        expect(ledger.getChannel(CHANNEL_ID)?.phases.comments).toMatchObject({ status: "completed", done: 2, total: 2 });
      });
    });

    describe("runTranscriptsPhase em resume", () => {
      it("pula Vídeos com Transcrição já ingerida (Segmentos ou ausência marcada)", async () => {
        const ledger = makeLedger();
        makeChannel(ledger);
        for (const [id, days] of [
          ["v1", 10],
          ["v2", 20],
          ["v3", 30],
        ] as const) {
          ledger.upsertVideo({
            id,
            channelId: CHANNEL_ID,
            title: `Vídeo ${id}`,
            description: "desc",
            publishedAt: daysAgo(days),
            views: 1,
            likes: 0,
            durationSeconds: 10,
          });
        }
        ledger.upsertTranscriptSegment({
          id: "v1:0",
          videoId: "v1",
          channelId: CHANNEL_ID,
          start: 0,
          end: 10,
          text: "trecho de v1",
        });
        ledger.markTranscriptAbsent("v2");
        ledger.updatePhase(CHANNEL_ID, "transcripts", { status: "failed" });

        const recording = makeRecordingTranscriptFetcher({
          v3: { videoId: "v3", segments: [{ start: 0, duration: 10, text: "trecho de v3" }] },
        });
        const ingestion = createIngestion({
          youtube: makeYouTubeClient([], {}),
          transcripts: recording.fetcher,
          ledger,
          projection: makeProjection(),
        });

        await ingestion.runTranscriptsPhase(CHANNEL_ID);

        expect(recording.calls).toEqual(["v3"]);
        expect(ledger.listTranscriptSegments(CHANNEL_ID).map((s) => s.videoId).sort()).toEqual(["v1", "v3"]);
        expect(ledger.listTranscriptAbsences(CHANNEL_ID)).toEqual(["v2"]);
        expect(ledger.getChannel(CHANNEL_ID)?.phases.transcripts).toMatchObject({ status: "completed", done: 3, total: 3 });
      });
    });

    describe("runJob em resume", () => {
      it("retoma a Fase que falhou sem reprocessar o que já foi ingerido", async () => {
        const ledger = makeLedger();
        makeChannel(ledger);
        const videos = [
          video("v3", "Recente", daysAgo(1)),
          video("v2", "Recente", daysAgo(2)),
          video("v1", "Recente", daysAgo(3)),
        ];
        const stats = {
          v1: { views: 1, likes: 0, durationSeconds: 10 },
          v2: { views: 2, likes: 0, durationSeconds: 20 },
          v3: { views: 3, likes: 0, durationSeconds: 30 },
        };
        const failingIngestion = makeIngestion(
          makeYouTubeClient(
            [{ videos, nextPageToken: null }],
            stats,
            {
              v3: [{ id: "c3", author: "A", text: "Comentário de v3", likes: 3, publishedAt: daysAgo(1) }],
              v2: new YouTubeApiError("cota esgotada", 403),
            },
          ),
          ledger,
        );

        await expect(failingIngestion.runJob(CHANNEL_ID)).rejects.toThrow("cota esgotada");

        expect(ledger.getChannel(CHANNEL_ID)).toMatchObject({
          status: "failed",
          phases: { comments: { status: "failed" } },
        });

        const commentsCalls: string[] = [];
        const okIngestion = createIngestion({
          youtube: makeYouTubeClient(
            [{ videos, nextPageToken: null }],
            stats,
            {
              v3: [{ id: "c3", author: "A", text: "Comentário de v3", likes: 3, publishedAt: daysAgo(1) }],
              v2: [{ id: "c2", author: "B", text: "Comentário de v2", likes: 2, publishedAt: daysAgo(1) }],
              v1: [{ id: "c1", author: "C", text: "Comentário de v1", likes: 1, publishedAt: daysAgo(1) }],
            },
            { commentsCalls },
          ),
          transcripts: makeTranscriptFetcher(),
          ledger,
          projection: makeProjection(),
        });

        await okIngestion.runJob(CHANNEL_ID);

        const channel = ledger.getChannel(CHANNEL_ID);
        expect(channel?.status).toBe("completed");
        expect(channel?.phases.videos).toMatchObject({ status: "completed" });
        expect(channel?.phases.comments).toMatchObject({ status: "completed" });
        expect(channel?.phases.transcripts).toMatchObject({ status: "completed" });
        expect(ledger.listVideos(CHANNEL_ID)).toHaveLength(3);
        expect(commentsCalls).toEqual(["v2", "v1"]);
        expect(ledger.listComments(CHANNEL_ID).map((c) => c.id).sort()).toEqual(["c1", "c2", "c3"]);
      });

      it("no resume da Fase de Vídeos, total é a contagem de Vídeos no Ledger (não o done)", async () => {
        const ledger = makeLedger();
        makeChannel(ledger);
        // Ledger já tem 2 Vídeos de uma ingestão anterior concluída
        for (const [id, days] of [
          ["v1", 200],
          ["v2", 180],
        ] as const) {
          ledger.upsertVideo({
            id,
            channelId: CHANNEL_ID,
            title: `Vídeo ${id}`,
            description: "desc",
            publishedAt: daysAgo(days),
            views: 1,
            likes: 0,
            durationSeconds: 10,
          });
        }
        ledger.updatePhase(CHANNEL_ID, "videos", { status: "completed" });

        const ingestion = makeIngestion(
          makeYouTubeClient(
            [{ videos: [video("v3", "Novo", daysAgo(1)), video("v1", "Antigo", daysAgo(200))], nextPageToken: null }],
            { v3: { views: 300, likes: 30, durationSeconds: 300 } },
          ),
          ledger,
        );

        await ingestion.runJob(CHANNEL_ID);

        // A Fase para cedo no v1 conhecido: done = 2 (v3 novo + v1 que disparou o stop),
        // mas total deve ser a contagem de Vídeos no Ledger = 3 (v1, v2, v3).
        expect(ledger.listVideos(CHANNEL_ID)).toHaveLength(3);
        expect(ledger.getChannel(CHANNEL_ID)?.phases.videos).toMatchObject({
          status: "completed",
          done: 2,
          total: 3,
        });
      });
    });

    describe("ghost sweep", () => {
      it("no Comentário phase sync mode, chama projection.remove para varrer Documentos stale do Vídeo antes de re-projetar", async () => {
        const ledger = makeLedger();
        makeChannel(ledger);
        ledger.upsertVideo({
          id: "v1",
          channelId: CHANNEL_ID,
          title: "Recente",
          description: "desc",
          publishedAt: daysAgo(10),
          views: 1,
          likes: 0,
          durationSeconds: 10,
        });
        ledger.upsertVideo({
          id: "v2",
          channelId: CHANNEL_ID,
          title: "Antigo",
          description: "desc",
          publishedAt: daysAgo(365),
          views: 2,
          likes: 0,
          durationSeconds: 20,
        });
        // c1 fica no Ledger da ingestão anterior; o Documento correspondente está no Índice
        ledger.upsertComment({
          id: "c1",
          videoId: "v1",
          channelId: CHANNEL_ID,
          author: "Antigo Autor",
          text: "Comentário antigo de v1",
          likes: 1,
          publishedAt: daysAgo(5),
        });
        ledger.upsertComment({
          id: "c2",
          videoId: "v2",
          channelId: CHANNEL_ID,
          author: "Autor",
          text: "Comentário de v2",
          likes: 2,
          publishedAt: daysAgo(300),
        });
        ledger.updatePhase(CHANNEL_ID, "comments", { status: "completed" });

        const projection = makeRecordingProjection();
        const ingestion = createIngestion({
          youtube: makeYouTubeClient(
            [],
            {},
            {
              v1: [
                { id: "c1", author: "Novo Autor", text: "Comentário atualizado", likes: 10, publishedAt: daysAgo(1) },
                { id: "c1b", author: "Outro", text: "Comentário novo", likes: 5, publishedAt: daysAgo(1) },
              ],
            },
          ),
          transcripts: makeTranscriptFetcher(),
          ledger,
          projection,
        });

        await ingestion.runCommentsPhase(CHANNEL_ID);

        // remove é chamado com o (channelId, predicate) que mira Documentos de Comentário do v1
        expect(projection.removeCalls).toHaveLength(1);
        expect(projection.removeCalls[0]?.channelId).toBe(CHANNEL_ID);
        const predicate = projection.removeCalls[0]?.predicate;
        expect(predicate).toBeDefined();
        if (!predicate) throw new Error("predicate ausente");
        expect(predicate({ id: "c1", type: "comment", channelId: CHANNEL_ID, videoId: "v1" })).toBe(true);
        expect(predicate({ id: "c1b", type: "comment", channelId: CHANNEL_ID, videoId: "v1" })).toBe(true);
        // não deve varrer Documentos de v2 ou de outros tipos
        expect(predicate({ id: "c2", type: "comment", channelId: CHANNEL_ID, videoId: "v2" })).toBe(false);
        expect(predicate({ id: "v1", type: "video", channelId: CHANNEL_ID })).toBe(false);
        expect(predicate({ id: "v1:0", type: "segment", channelId: CHANNEL_ID, videoId: "v1" })).toBe(false);

        // remove foi chamado antes do addDocuments dos novos Documentos
        const removeOrder = projection.removeCalls[0];
        const addCall = projection.calls.find((c) => c.documents.some((d) => d.type === "comment"));
        expect(removeOrder).toBeDefined();
        expect(addCall).toBeDefined();
      });

      it("no Comentário phase sync mode, chama projection.remove quando o Vídeo antes tinha Comentários e agora não tem mais (shift para zero)", async () => {
        const ledger = makeLedger();
        makeChannel(ledger);
        ledger.upsertVideo({
          id: "v1",
          channelId: CHANNEL_ID,
          title: "Vídeo v1",
          description: "desc",
          publishedAt: daysAgo(10),
          views: 1,
          likes: 0,
          durationSeconds: 10,
        });
        // Comentários antigos do v1 ficam no Ledger da ingestão anterior; os Documentos correspondentes estão no Índice
        ledger.upsertComment({
          id: "c1",
          videoId: "v1",
          channelId: CHANNEL_ID,
          author: "Antigo Autor",
          text: "Comentário antigo",
          likes: 5,
          publishedAt: daysAgo(20),
        });
        ledger.updatePhase(CHANNEL_ID, "comments", { status: "completed" });

        const projection = makeRecordingProjection();
        const ingestion = createIngestion({
          youtube: makeYouTubeClient([], {}, {
            v1: [], // Sincronização encontra zero Comentários
          }),
          transcripts: makeTranscriptFetcher(),
          ledger,
          projection,
        });

        await ingestion.runCommentsPhase(CHANNEL_ID);

        // remove é chamado para varrer Documentos de Comentário stale do v1
        expect(projection.removeCalls).toHaveLength(1);
        expect(projection.removeCalls[0]?.channelId).toBe(CHANNEL_ID);
        const predicate = projection.removeCalls[0]?.predicate;
        expect(predicate).toBeDefined();
        if (!predicate) throw new Error("predicate ausente");
        expect(predicate({ id: "c1", type: "comment", channelId: CHANNEL_ID, videoId: "v1" })).toBe(true);
        expect(predicate({ id: "v1", type: "video", channelId: CHANNEL_ID })).toBe(false);

        // Ledger limpo: sem Comentários e com ausência marcada
        expect(ledger.listComments(CHANNEL_ID)).toEqual([]);
        expect(ledger.listCommentAbsences(CHANNEL_ID)).toEqual(["v1"]);

        // Nenhum Documento de Comentário é re-projetado
        const addedDocs = projection.calls.flatMap((c) => c.documents);
        expect(addedDocs.filter((d) => d.type === "comment")).toEqual([]);
      });

      it("no Comentário phase initial mode, não chama projection.remove ao re-projetar Vídeos sem Comentário prévio", async () => {
        const ledger = makeLedger();
        makeChannel(ledger);
        ledger.upsertVideo({
          id: "v1",
          channelId: CHANNEL_ID,
          title: "Vídeo v1",
          description: "desc",
          publishedAt: daysAgo(10),
          views: 1,
          likes: 0,
          durationSeconds: 10,
        });
        // phase comments = pending (ingestão inicial, ainda sem Documentos no Índice)

        const projection = makeRecordingProjection();
        const ingestion = createIngestion({
          youtube: makeYouTubeClient(
            [],
            {},
            {
              v1: [{ id: "c1", author: "A", text: "Primeiro comentário", likes: 1, publishedAt: daysAgo(1) }],
            },
          ),
          transcripts: makeTranscriptFetcher(),
          ledger,
          projection,
        });

        await ingestion.runCommentsPhase(CHANNEL_ID);

        expect(projection.removeCalls).toEqual([]);
        expect(projection.calls).toHaveLength(1);
      });

      it("no Transcrição phase, chama projection.remove para varrer Segmentos stale do Vídeo antes de re-projetar quando a Transcrição mudou", async () => {
        const ledger = makeLedger();
        makeChannel(ledger);
        ledger.upsertVideo({
          id: "v1",
          channelId: CHANNEL_ID,
          title: "Vídeo v1",
          description: "desc",
          publishedAt: daysAgo(10),
          views: 1,
          likes: 0,
          durationSeconds: 10,
        });
        // Segmentos antigos do v1 ficam no Ledger da ingestão anterior; o Documento correspondente está no Índice
        ledger.upsertTranscriptSegment({
          id: "v1:0",
          videoId: "v1",
          channelId: CHANNEL_ID,
          start: 0,
          end: 10,
          text: "trecho antigo de v1",
        });
        // marca a Fase como completed (modo Sincronização: vou re-processar a Transcrição)
        ledger.updatePhase(CHANNEL_ID, "transcripts", { status: "completed" });

        const projection = makeRecordingProjection();
        const fetcher = makeTranscriptFetcherWith({
          v1: {
            videoId: "v1",
            segments: [
              { start: 0, duration: 10, text: "trecho novo de v1" },
              { start: 142, duration: 8, text: "trecho novo de v1 com deep-link" },
            ],
          },
        });
        const ingestion = createIngestion({
          youtube: makeYouTubeClient([], {}),
          transcripts: fetcher,
          ledger,
          projection,
        });

        await ingestion.runTranscriptsPhase(CHANNEL_ID);

        // remove é chamado para varrer Segmentos do v1 antes de re-projetar
        expect(projection.removeCalls).toHaveLength(1);
        expect(projection.removeCalls[0]?.channelId).toBe(CHANNEL_ID);
        const predicate = projection.removeCalls[0]?.predicate;
        expect(predicate).toBeDefined();
        if (!predicate) throw new Error("predicate ausente");
        expect(predicate({ id: "v1:0", type: "segment", channelId: CHANNEL_ID, videoId: "v1" })).toBe(true);
        expect(predicate({ id: "v1:142", type: "segment", channelId: CHANNEL_ID, videoId: "v1" })).toBe(true);
        // não deve varrer Documentos de outros tipos
        expect(predicate({ id: "v1", type: "video", channelId: CHANNEL_ID })).toBe(false);
        expect(predicate({ id: "c1", type: "comment", channelId: CHANNEL_ID, videoId: "v1" })).toBe(false);

        // Segmentos antigos foram substituídos pelos novos no Ledger
        const storedSegments = ledger.listTranscriptSegments(CHANNEL_ID);
        expect(storedSegments).toHaveLength(2);
        expect(storedSegments.find((s) => s.start === 0)?.text).toBe("trecho novo de v1");
        expect(storedSegments.find((s) => s.start === 142)?.text).toBe("trecho novo de v1 com deep-link");
      });

      it("no Transcrição phase, quando a Transcrição não está disponível, remove não é chamado (não há re-projeção)", async () => {
        const ledger = makeLedger();
        makeChannel(ledger);
        ledger.upsertVideo({
          id: "v1",
          channelId: CHANNEL_ID,
          title: "Vídeo v1",
          description: "desc",
          publishedAt: daysAgo(10),
          views: 1,
          likes: 0,
          durationSeconds: 10,
        });
        ledger.updatePhase(CHANNEL_ID, "transcripts", { status: "completed" });

        const projection = makeRecordingProjection();
        // fetcher devolve null para v1 (transcrição indisponível)
        const ingestion = createIngestion({
          youtube: makeYouTubeClient([], {}),
          transcripts: makeTranscriptFetcher(),
          ledger,
          projection,
        });

        await ingestion.runTranscriptsPhase(CHANNEL_ID);

        // sem re-projeção, remove não é chamado e nenhum Documento é projetado
        expect(projection.removeCalls).toEqual([]);
        const addedDocs = projection.calls.flatMap((c) => c.documents);
        expect(addedDocs.filter((d) => d.type === "segment")).toEqual([]);
        expect(ledger.listTranscriptAbsences(CHANNEL_ID)).toEqual(["v1"]);
      });
    });
  });
});