import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/schema.js";
import { SqliteLedger } from "../src/ledger.js";

const CHANNEL_ID = "UCY8iijN1AkyDCh1Z9akcqUA";

function makeLedger() {
  const db = createDatabase(":memory:");
  return new SqliteLedger(db);
}

describe("SqliteLedger", () => {
  describe("createChannel", () => {
    it("cria um Canal com status queued e as três Fases em pending", async () => {
      const ledger = makeLedger();

      const channel = await ledger.createChannel({
        channelId: "UCY8iijN1AkyDCh1Z9akcqUA",
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });

      expect(channel).toMatchObject({
        id: "UCY8iijN1AkyDCh1Z9akcqUA",
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
        status: "queued",
      });
      expect(channel.phases).toMatchObject({
        videos: { phase: "videos", status: "pending", done: 0, total: null },
        comments: { phase: "comments", status: "pending", done: 0, total: null },
        transcripts: { phase: "transcripts", status: "pending", done: 0, total: null },
      });
    });

    it("é idempotente quando o mesmo channelId já existe", async () => {
      const ledger = makeLedger();
      const input = {
        channelId: "UCY8iijN1AkyDCh1Z9akcqUA",
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      };

      await ledger.createChannel(input);
      const again = await ledger.createChannel(input);

      expect(again.id).toBe(input.channelId);
    });
  });

  describe("getChannel", () => {
    it("devolve o Canal criado com status e progresso por Fase", async () => {
      const ledger = makeLedger();
      const input = {
        channelId: "UCY8iijN1AkyDCh1Z9akcqUA",
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      };
      await ledger.createChannel(input);

      const channel = await ledger.getChannel(input.channelId);

      expect(channel).not.toBeNull();
      expect(channel?.id).toBe(input.channelId);
      expect(channel?.status).toBe("queued");
      expect(Object.keys(channel?.phases ?? {})).toEqual(["videos", "comments", "transcripts"]);
    });

    it("devolve null para um channelId desconhecido", async () => {
      const ledger = makeLedger();

      expect(await ledger.getChannel("desconhecido")).toBeNull();
    });
  });

  describe("setChannelError / clearChannelError", () => {
    it("grava o motivo da falha e o devolve via getChannel", async () => {
      const ledger = makeLedger();
      await ledger.createChannel({
        channelId: CHANNEL_ID,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });

      await ledger.setChannelError(CHANNEL_ID, "cota esgotada");

      expect((await ledger.getChannel(CHANNEL_ID))?.lastError).toBe("cota esgotada");
    });

    it("clearChannelError volta lastError para null", async () => {
      const ledger = makeLedger();
      await ledger.createChannel({
        channelId: CHANNEL_ID,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      await ledger.setChannelError(CHANNEL_ID, "cota esgotada");

      await ledger.clearChannelError(CHANNEL_ID);

      expect((await ledger.getChannel(CHANNEL_ID))?.lastError).toBeNull();
    });

    it("criar o Canal de novo zera o lastError", async () => {
      const ledger = makeLedger();
      await ledger.createChannel({
        channelId: CHANNEL_ID,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      await ledger.setChannelError(CHANNEL_ID, "cota esgotada");

      await ledger.createChannel({
        channelId: CHANNEL_ID,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });

      expect((await ledger.getChannel(CHANNEL_ID))?.lastError).toBeNull();
    });
  });

  describe("deleteChannel", () => {
    it("apaga o Canal e o faz sumir de getChannel / listChannels", async () => {
      const ledger = makeLedger();
      await ledger.createChannel({
        channelId: CHANNEL_ID,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      await ledger.updatePhase(CHANNEL_ID, "videos", { status: "completed", done: 2, total: 2 });

      await ledger.deleteChannel(CHANNEL_ID);

      expect(await ledger.getChannel(CHANNEL_ID)).toBeNull();
      expect(await ledger.listChannels()).toEqual([]);
    });

    it("não falha quando o channelId não existe (idempotente)", async () => {
      const ledger = makeLedger();

      await expect(ledger.deleteChannel("desconhecido")).resolves.toBeUndefined();
    });
  });

  describe("upsertComment / listComments", () => {
    async function makeChannelWithVideo(ledger: SqliteLedger) {
      const channel = await ledger.createChannel({
        channelId: CHANNEL_ID,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      await ledger.upsertVideo({
        id: "v1",
        channelId: CHANNEL_ID,
        title: "Primeiro vídeo",
        description: "Uma descrição",
        publishedAt: "2023-01-01T00:00:00Z",
        views: 100,
        likes: 10,
        durationSeconds: 120,
      });
      return channel;
    }

    it("grava um Comentário ligado ao Vídeo e o devolve como linha canônica", async () => {
      const ledger = makeLedger();
      await makeChannelWithVideo(ledger);
      await ledger.upsertComment({
        id: "c1",
        videoId: "v1",
        channelId: CHANNEL_ID,
        author: "Gato Funky",
        text: "Primeiro comentário",
        likes: 42,
        publishedAt: "2023-01-02T00:00:00Z",
      });

      const comments = await ledger.listComments(CHANNEL_ID);

      expect(comments).toEqual([
        {
          id: "c1",
          videoId: "v1",
          channelId: CHANNEL_ID,
          author: "Gato Funky",
          text: "Primeiro comentário",
          likes: 42,
          publishedAt: "2023-01-02T00:00:00Z",
        },
      ]);
    });

    it("é idempotente quando o mesmo id de Comentário é gravado de novo", async () => {
      const ledger = makeLedger();
      await makeChannelWithVideo(ledger);
      const comment = {
        id: "c1",
        videoId: "v1",
        channelId: CHANNEL_ID,
        author: "Gato Funky",
        text: "Primeiro comentário",
        likes: 42,
        publishedAt: "2023-01-02T00:00:00Z",
      };

      await ledger.upsertComment(comment);
      await ledger.upsertComment(comment);

      expect(await ledger.listComments(CHANNEL_ID)).toHaveLength(1);
    });

    it("devolve lista vazia para um Canal sem Comentários", async () => {
      const ledger = makeLedger();
      await makeChannelWithVideo(ledger);

      expect(await ledger.listComments(CHANNEL_ID)).toEqual([]);
    });
  });

  describe("upsertTranscriptSegment / listTranscriptSegments", () => {
    async function makeChannelWithVideo(ledger: SqliteLedger) {
      const channel = await ledger.createChannel({
        channelId: CHANNEL_ID,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      await ledger.upsertVideo({
        id: "v1",
        channelId: CHANNEL_ID,
        title: "Primeiro vídeo",
        description: "Uma descrição",
        publishedAt: "2023-01-01T00:00:00Z",
        views: 100,
        likes: 10,
        durationSeconds: 120,
      });
      return channel;
    }

    it("grava um Segmento ligado ao Vídeo e o devolve como linha canônica", async () => {
      const ledger = makeLedger();
      await makeChannelWithVideo(ledger);
      await ledger.upsertTranscriptSegment({
        id: "v1:142",
        videoId: "v1",
        channelId: CHANNEL_ID,
        start: 142,
        end: 150,
        text: "trecho da transcrição",
      });

      const segments = await ledger.listTranscriptSegments(CHANNEL_ID);

      expect(segments).toEqual([
        {
          id: "v1:142",
          videoId: "v1",
          channelId: CHANNEL_ID,
          start: 142,
          end: 150,
          text: "trecho da transcrição",
        },
      ]);
    });

    it("é idempotente quando o mesmo Segmento (vídeo + start) é gravado de novo", async () => {
      const ledger = makeLedger();
      await makeChannelWithVideo(ledger);
      const segment = {
        id: "v1:142",
        videoId: "v1",
        channelId: CHANNEL_ID,
        start: 142,
        end: 150,
        text: "trecho da transcrição",
      };

      await ledger.upsertTranscriptSegment(segment);
      await ledger.upsertTranscriptSegment(segment);

      expect(await ledger.listTranscriptSegments(CHANNEL_ID)).toHaveLength(1);
    });

    it("devolve lista vazia para um Canal sem Segmentos", async () => {
      const ledger = makeLedger();
      await makeChannelWithVideo(ledger);

      expect(await ledger.listTranscriptSegments(CHANNEL_ID)).toEqual([]);
    });
  });

  describe("markTranscriptAbsent / listTranscriptAbsences", () => {
    async function makeChannelWithVideo(ledger: SqliteLedger) {
      await ledger.createChannel({
        channelId: CHANNEL_ID,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      await ledger.upsertVideo({
        id: "v1",
        channelId: CHANNEL_ID,
        title: "Primeiro vídeo",
        description: "Uma descrição",
        publishedAt: "2023-01-01T00:00:00Z",
        views: 100,
        likes: 10,
        durationSeconds: 120,
      });
      await ledger.upsertVideo({
        id: "v2",
        channelId: CHANNEL_ID,
        title: "Segundo vídeo",
        description: "Outra descrição",
        publishedAt: "2023-01-02T00:00:00Z",
        views: 200,
        likes: 20,
        durationSeconds: 240,
      });
    }

    it("marca um Vídeo sem Transcrição e o lista como ausência", async () => {
      const ledger = makeLedger();
      await makeChannelWithVideo(ledger);

      await ledger.markTranscriptAbsent("v1");

      expect(await ledger.listTranscriptAbsences(CHANNEL_ID)).toEqual(["v1"]);
    });

    it("é idempotente ao marcar a mesma ausência de novo", async () => {
      const ledger = makeLedger();
      await makeChannelWithVideo(ledger);

      await ledger.markTranscriptAbsent("v1");
      await ledger.markTranscriptAbsent("v1");

      expect(await ledger.listTranscriptAbsences(CHANNEL_ID)).toEqual(["v1"]);
    });

    it("devolve lista vazia quando nenhum Vídeo está sem Transcrição", async () => {
      const ledger = makeLedger();
      await makeChannelWithVideo(ledger);

      expect(await ledger.listTranscriptAbsences(CHANNEL_ID)).toEqual([]);
    });
  });

  describe("hasVideo", () => {
    async function makeChannelWithVideo(ledger: SqliteLedger) {
      await ledger.createChannel({
        channelId: CHANNEL_ID,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      await ledger.upsertVideo({
        id: "v1",
        channelId: CHANNEL_ID,
        title: "Primeiro vídeo",
        description: "Uma descrição",
        publishedAt: "2023-01-01T00:00:00Z",
        views: 100,
        likes: 10,
        durationSeconds: 120,
      });
    }

    it("devolve true para um Vídeo já gravado e false para um desconhecido", async () => {
      const ledger = makeLedger();
      await makeChannelWithVideo(ledger);

      expect(await ledger.hasVideo("v1")).toBe(true);
      expect(await ledger.hasVideo("v2")).toBe(false);
    });
  });

  describe("videoContext", () => {
    async function makeChannelWithVideo(ledger: SqliteLedger) {
      await ledger.createChannel({
        channelId: CHANNEL_ID,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      await ledger.upsertVideo({
        id: "v1",
        channelId: CHANNEL_ID,
        title: "Primeiro vídeo",
        description: "Uma descrição",
        publishedAt: "2023-01-01T00:00:00Z",
        views: 100,
        likes: 10,
        durationSeconds: 120,
      });
    }

    it("devolve o contexto canônico do Vídeo (sem description/durationSeconds)", async () => {
      const ledger = makeLedger();
      await makeChannelWithVideo(ledger);

      expect(await ledger.videoContext("v1")).toEqual({
        id: "v1",
        title: "Primeiro vídeo",
        views: 100,
        likes: 10,
        publishedAt: "2023-01-01T00:00:00Z",
      });
    });

    it("devolve null para um Vídeo desconhecido", async () => {
      const ledger = makeLedger();
      await makeChannelWithVideo(ledger);

      expect(await ledger.videoContext("v2")).toBeNull();
    });
  });

  describe("comment_absences", () => {
    async function makeChannelWithVideos(ledger: SqliteLedger) {
      await ledger.createChannel({
        channelId: CHANNEL_ID,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      for (const id of ["v1", "v2"]) {
        await ledger.upsertVideo({
          id,
          channelId: CHANNEL_ID,
          title: `Vídeo ${id}`,
          description: "Uma descrição",
          publishedAt: "2023-01-01T00:00:00Z",
          views: 100,
          likes: 10,
          durationSeconds: 120,
        });
      }
    }

    it("marca um Vídeo sem Comentários (desativados/vazio) e o lista como ausência", async () => {
      const ledger = makeLedger();
      await makeChannelWithVideos(ledger);

      await ledger.markCommentAbsence("v1", "disabled");
      await ledger.markCommentAbsence("v2", "none");

      expect(await ledger.listCommentAbsences(CHANNEL_ID)).toEqual(["v1", "v2"]);
    });

    it("é idempotente ao marcar a mesma ausência de novo", async () => {
      const ledger = makeLedger();
      await makeChannelWithVideos(ledger);

      await ledger.markCommentAbsence("v1", "disabled");
      await ledger.markCommentAbsence("v1", "disabled");

      expect(await ledger.listCommentAbsences(CHANNEL_ID)).toEqual(["v1"]);
    });

    it("clearCommentAbsence remove a marcação", async () => {
      const ledger = makeLedger();
      await makeChannelWithVideos(ledger);
      await ledger.markCommentAbsence("v1", "none");

      await ledger.clearCommentAbsence("v1");

      expect(await ledger.listCommentAbsences(CHANNEL_ID)).toEqual([]);
    });

    it("devolve lista vazia quando nenhum Vídeo está com Comentários ausentes", async () => {
      const ledger = makeLedger();
      await makeChannelWithVideos(ledger);

      expect(await ledger.listCommentAbsences(CHANNEL_ID)).toEqual([]);
    });
  });

  describe("hasCommentIngestion", () => {
    async function makeChannelWithVideo(ledger: SqliteLedger) {
      await ledger.createChannel({
        channelId: CHANNEL_ID,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      await ledger.upsertVideo({
        id: "v1",
        channelId: CHANNEL_ID,
        title: "Primeiro vídeo",
        description: "Uma descrição",
        publishedAt: "2023-01-01T00:00:00Z",
        views: 100,
        likes: 10,
        durationSeconds: 120,
      });
    }

    it("devolve true quando o Vídeo tem Comentários gravados", async () => {
      const ledger = makeLedger();
      await makeChannelWithVideo(ledger);
      await ledger.upsertComment({
        id: "c1",
        videoId: "v1",
        channelId: CHANNEL_ID,
        author: "Gato Funky",
        text: "Primeiro comentário",
        likes: 42,
        publishedAt: "2023-01-02T00:00:00Z",
      });

      expect(await ledger.hasCommentIngestion("v1")).toBe(true);
    });

    it("devolve true quando o Vídeo tem ausência de Comentários marcada", async () => {
      const ledger = makeLedger();
      await makeChannelWithVideo(ledger);
      await ledger.markCommentAbsence("v1", "disabled");

      expect(await ledger.hasCommentIngestion("v1")).toBe(true);
    });

    it("devolve false quando nada foi ingerido para o Vídeo", async () => {
      const ledger = makeLedger();
      await makeChannelWithVideo(ledger);

      expect(await ledger.hasCommentIngestion("v1")).toBe(false);
    });
  });

  describe("deleteCommentsForVideo", () => {
    it("remove apenas os Comentários do Vídeo indicado", async () => {
      const ledger = makeLedger();
      await ledger.createChannel({
        channelId: CHANNEL_ID,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      for (const id of ["v1", "v2"]) {
        await ledger.upsertVideo({
          id,
          channelId: CHANNEL_ID,
          title: `Vídeo ${id}`,
          description: "Uma descrição",
          publishedAt: "2023-01-01T00:00:00Z",
          views: 100,
          likes: 10,
          durationSeconds: 120,
        });
      }
      await ledger.upsertComment({
        id: "c1",
        videoId: "v1",
        channelId: CHANNEL_ID,
        author: "A",
        text: "Comentário de v1",
        likes: 1,
        publishedAt: "2023-01-02T00:00:00Z",
      });
      await ledger.upsertComment({
        id: "c2",
        videoId: "v2",
        channelId: CHANNEL_ID,
        author: "B",
        text: "Comentário de v2",
        likes: 2,
        publishedAt: "2023-01-03T00:00:00Z",
      });

      await ledger.deleteCommentsForVideo("v1");

      expect((await ledger.listComments(CHANNEL_ID)).map((c) => c.id)).toEqual(["c2"]);
    });
  });

  describe("hasTranscriptIngestion", () => {
    async function makeChannelWithVideo(ledger: SqliteLedger) {
      await ledger.createChannel({
        channelId: CHANNEL_ID,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      await ledger.upsertVideo({
        id: "v1",
        channelId: CHANNEL_ID,
        title: "Primeiro vídeo",
        description: "Uma descrição",
        publishedAt: "2023-01-01T00:00:00Z",
        views: 100,
        likes: 10,
        durationSeconds: 120,
      });
    }

    it("devolve true quando o Vídeo tem Segmentos de Transcrição gravados", async () => {
      const ledger = makeLedger();
      await makeChannelWithVideo(ledger);
      await ledger.upsertTranscriptSegment({
        id: "v1:0",
        videoId: "v1",
        channelId: CHANNEL_ID,
        start: 0,
        end: 10,
        text: "trecho",
      });

      expect(await ledger.hasTranscriptIngestion("v1")).toBe(true);
    });

    it("devolve true quando o Vídeo tem ausência de Transcrição marcada", async () => {
      const ledger = makeLedger();
      await makeChannelWithVideo(ledger);
      await ledger.markTranscriptAbsent("v1");

      expect(await ledger.hasTranscriptIngestion("v1")).toBe(true);
    });

    it("devolve false quando nada foi ingerido para o Vídeo", async () => {
      const ledger = makeLedger();
      await makeChannelWithVideo(ledger);

      expect(await ledger.hasTranscriptIngestion("v1")).toBe(false);
    });
  });
});