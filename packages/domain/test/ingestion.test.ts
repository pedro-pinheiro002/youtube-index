import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/schema.js";
import { SqliteLedger } from "../src/ledger.js";
import { createIngestion } from "../src/ingestion.js";
import { CommentsDisabledError } from "../src/youtube.js";
import type {
  Ledger,
  Projection,
  SearchDocument,
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

function makeLedger(): Ledger {
  return new SqliteLedger(createDatabase(":memory:"));
}

function makeTranscriptFetcher(): TranscriptFetcher {
  return { fetchTranscript: async () => null };
}

function makeProjection(): Projection {
  return { addDocuments: async () => {} };
}

function makeRecordingProjection() {
  const calls: Array<{ channelId: string; documents: SearchDocument[] }> = [];
  return {
    addDocuments: async (channelId: string, documents: SearchDocument[]) => {
      calls.push({ channelId, documents });
    },
    calls,
  };
}

function makeYouTubeClient(
  pages: FakePage[],
  stats: Record<string, YouTubeVideoStats>,
  comments: Record<string, YouTubeComment[] | Error> = {},
): YouTubeClient {
  const byToken = new Map<string | null, FakePage>();
  for (let i = 0; i < pages.length; i++) {
    byToken.set(i === 0 ? null : pages[i - 1]!.nextPageToken, pages[i]!);
  }
  return {
    resolveHandle: async () => ({ channelId: CHANNEL_ID, title: "Funky Black Cat" }),
    getUploadsPlaylistId: async () => UPLOADS_PLAYLIST_ID,
    listUploads: async (_playlistId, pageToken) => {
      const page = byToken.get(pageToken ?? null);
      if (!page) throw new Error(`página inesperada: ${pageToken}`);
      return page;
    },
    getVideoStats: async (videoId) => stats[videoId] ?? null,
    listComments: async (videoId) => {
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
        total: 2,
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

    it("busca Comentários por Vídeo e os grava no Ledger com contexto do Vídeo", async () => {
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
            videoTitle: "Primeiro vídeo",
            author: "Gato Funky",
            text: "Primeiro comentário",
            likes: 42,
          }),
          expect.objectContaining({
            id: "c2",
            videoId: "v2",
            videoTitle: "Segundo vídeo",
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
      expect(ledger.listComments(CHANNEL_ID)).toHaveLength(1);
      expect(projection.calls.flatMap((c) => c.documents.map((d) => d.type))).toEqual(["video", "comment"]);
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
    });
  });
});