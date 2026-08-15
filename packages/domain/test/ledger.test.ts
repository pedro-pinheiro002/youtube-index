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
    it("cria um Canal com status queued e as três Fases em pending", () => {
      const ledger = makeLedger();

      const channel = ledger.createChannel({
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

    it("é idempotente quando o mesmo channelId já existe", () => {
      const ledger = makeLedger();
      const input = {
        channelId: "UCY8iijN1AkyDCh1Z9akcqUA",
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      };

      ledger.createChannel(input);
      const again = ledger.createChannel(input);

      expect(again.id).toBe(input.channelId);
    });
  });

  describe("getChannel", () => {
    it("devolve o Canal criado com status e progresso por Fase", () => {
      const ledger = makeLedger();
      const input = {
        channelId: "UCY8iijN1AkyDCh1Z9akcqUA",
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      };
      ledger.createChannel(input);

      const channel = ledger.getChannel(input.channelId);

      expect(channel).not.toBeNull();
      expect(channel?.id).toBe(input.channelId);
      expect(channel?.status).toBe("queued");
      expect(Object.keys(channel?.phases ?? {})).toEqual(["videos", "comments", "transcripts"]);
    });

    it("devolve null para um channelId desconhecido", () => {
      const ledger = makeLedger();

      expect(ledger.getChannel("desconhecido")).toBeNull();
    });
  });

  describe("enqueueJob", () => {
    it("enfileira um job de Ingestão na Fila com status queued", () => {
      const ledger = makeLedger();
      const channel = ledger.createChannel({
        channelId: "UCY8iijN1AkyDCh1Z9akcqUA",
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });

      const job = ledger.enqueueJob(channel.id);

      expect(job).toMatchObject({
        channelId: channel.id,
        status: "queued",
      });
      expect(typeof job.id).toBe("number");
    });

    it("lista os jobs enfileirados de um Canal", () => {
      const ledger = makeLedger();
      const channel = ledger.createChannel({
        channelId: "UCY8iijN1AkyDCh1Z9akcqUA",
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });

      ledger.enqueueJob(channel.id);
      ledger.enqueueJob(channel.id);

      const jobs = ledger.listJobs(channel.id);
      expect(jobs).toHaveLength(2);
      expect(jobs[0]).toMatchObject({ channelId: channel.id, status: "queued" });
    });
  });

  describe("claimNextJob", () => {
    it("reivindica o job mais antigo em ordem FIFO e o marca como running", () => {
      const ledger = makeLedger();
      const channel = ledger.createChannel({
        channelId: "UCY8iijN1AkyDCh1Z9akcqUA",
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      ledger.enqueueJob(channel.id);
      ledger.enqueueJob(channel.id);

      const first = ledger.claimNextJob();
      const second = ledger.claimNextJob();

      expect(first).toMatchObject({ id: 1, channelId: channel.id, status: "running" });
      expect(second).toMatchObject({ id: 2, channelId: channel.id, status: "running" });
      expect(ledger.listJobs(channel.id).every((j) => j.status === "running")).toBe(true);
    });

    it("não reivindica um job que já está running", () => {
      const ledger = makeLedger();
      const channel = ledger.createChannel({
        channelId: "UCY8iijN1AkyDCh1Z9akcqUA",
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      ledger.enqueueJob(channel.id);

      ledger.claimNextJob();

      expect(ledger.claimNextJob()).toBeNull();
    });

    it("devolve null quando não há job na Fila", () => {
      const ledger = makeLedger();

      expect(ledger.claimNextJob()).toBeNull();
    });
  });

  describe("completeJob / failJob", () => {
    it("marca o job como completed ou failed", () => {
      const ledger = makeLedger();
      const channel = ledger.createChannel({
        channelId: "UCY8iijN1AkyDCh1Z9akcqUA",
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      const ok = ledger.enqueueJob(channel.id);
      const bad = ledger.enqueueJob(channel.id);

      ledger.completeJob(ok.id);
      ledger.failJob(bad.id);

      expect(ledger.listJobs(channel.id)).toEqual([
        expect.objectContaining({ id: ok.id, status: "completed" }),
        expect.objectContaining({ id: bad.id, status: "failed" }),
      ]);
    });
  });

  describe("upsertComment / listComments", () => {
    function makeChannelWithVideo(ledger: SqliteLedger) {
      const channel = ledger.createChannel({
        channelId: CHANNEL_ID,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      ledger.upsertVideo({
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

    it("grava um Comentário ligado ao Vídeo e o devolve com o título do Vídeo", () => {
      const ledger = makeLedger();
      makeChannelWithVideo(ledger);
      ledger.upsertComment({
        id: "c1",
        videoId: "v1",
        channelId: CHANNEL_ID,
        videoTitle: "Primeiro vídeo",
        author: "Gato Funky",
        text: "Primeiro comentário",
        likes: 42,
        publishedAt: "2023-01-02T00:00:00Z",
      });

      const comments = ledger.listComments(CHANNEL_ID);

      expect(comments).toEqual([
        expect.objectContaining({
          id: "c1",
          videoId: "v1",
          channelId: CHANNEL_ID,
          videoTitle: "Primeiro vídeo",
          author: "Gato Funky",
          text: "Primeiro comentário",
          likes: 42,
          publishedAt: "2023-01-02T00:00:00Z",
        }),
      ]);
    });

    it("é idempotente quando o mesmo id de Comentário é gravado de novo", () => {
      const ledger = makeLedger();
      makeChannelWithVideo(ledger);
      const comment = {
        id: "c1",
        videoId: "v1",
        channelId: CHANNEL_ID,
        videoTitle: "Primeiro vídeo",
        author: "Gato Funky",
        text: "Primeiro comentário",
        likes: 42,
        publishedAt: "2023-01-02T00:00:00Z",
      };

      ledger.upsertComment(comment);
      ledger.upsertComment(comment);

      expect(ledger.listComments(CHANNEL_ID)).toHaveLength(1);
    });

    it("devolve lista vazia para um Canal sem Comentários", () => {
      const ledger = makeLedger();
      makeChannelWithVideo(ledger);

      expect(ledger.listComments(CHANNEL_ID)).toEqual([]);
    });
  });

  describe("upsertTranscriptSegment / listTranscriptSegments", () => {
    function makeChannelWithVideo(ledger: SqliteLedger) {
      const channel = ledger.createChannel({
        channelId: CHANNEL_ID,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      ledger.upsertVideo({
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

    it("grava um Segmento ligado ao Vídeo e o devolve com o contexto do Vídeo", () => {
      const ledger = makeLedger();
      makeChannelWithVideo(ledger);
      ledger.upsertTranscriptSegment({
        id: "v1:142",
        videoId: "v1",
        channelId: CHANNEL_ID,
        videoTitle: "Primeiro vídeo",
        videoPublishedAt: "2023-01-01T00:00:00Z",
        start: 142,
        end: 150,
        text: "trecho da transcrição",
      });

      const segments = ledger.listTranscriptSegments(CHANNEL_ID);

      expect(segments).toEqual([
        expect.objectContaining({
          id: "v1:142",
          videoId: "v1",
          channelId: CHANNEL_ID,
          videoTitle: "Primeiro vídeo",
          videoPublishedAt: "2023-01-01T00:00:00Z",
          start: 142,
          end: 150,
          text: "trecho da transcrição",
        }),
      ]);
    });

    it("é idempotente quando o mesmo Segmento (vídeo + start) é gravado de novo", () => {
      const ledger = makeLedger();
      makeChannelWithVideo(ledger);
      const segment = {
        id: "v1:142",
        videoId: "v1",
        channelId: CHANNEL_ID,
        videoTitle: "Primeiro vídeo",
        videoPublishedAt: "2023-01-01T00:00:00Z",
        start: 142,
        end: 150,
        text: "trecho da transcrição",
      };

      ledger.upsertTranscriptSegment(segment);
      ledger.upsertTranscriptSegment(segment);

      expect(ledger.listTranscriptSegments(CHANNEL_ID)).toHaveLength(1);
    });

    it("devolve lista vazia para um Canal sem Segmentos", () => {
      const ledger = makeLedger();
      makeChannelWithVideo(ledger);

      expect(ledger.listTranscriptSegments(CHANNEL_ID)).toEqual([]);
    });
  });

  describe("markTranscriptAbsent / listTranscriptAbsences", () => {
    function makeChannelWithVideo(ledger: SqliteLedger) {
      ledger.createChannel({
        channelId: CHANNEL_ID,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      ledger.upsertVideo({
        id: "v1",
        channelId: CHANNEL_ID,
        title: "Primeiro vídeo",
        description: "Uma descrição",
        publishedAt: "2023-01-01T00:00:00Z",
        views: 100,
        likes: 10,
        durationSeconds: 120,
      });
      ledger.upsertVideo({
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

    it("marca um Vídeo sem Transcrição e o lista como ausência", () => {
      const ledger = makeLedger();
      makeChannelWithVideo(ledger);

      ledger.markTranscriptAbsent("v1");

      expect(ledger.listTranscriptAbsences(CHANNEL_ID)).toEqual(["v1"]);
    });

    it("é idempotente ao marcar a mesma ausência de novo", () => {
      const ledger = makeLedger();
      makeChannelWithVideo(ledger);

      ledger.markTranscriptAbsent("v1");
      ledger.markTranscriptAbsent("v1");

      expect(ledger.listTranscriptAbsences(CHANNEL_ID)).toEqual(["v1"]);
    });

    it("devolve lista vazia quando nenhum Vídeo está sem Transcrição", () => {
      const ledger = makeLedger();
      makeChannelWithVideo(ledger);

      expect(ledger.listTranscriptAbsences(CHANNEL_ID)).toEqual([]);
    });
  });

  describe("hasVideo", () => {
    function makeChannelWithVideo(ledger: SqliteLedger) {
      ledger.createChannel({
        channelId: CHANNEL_ID,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      ledger.upsertVideo({
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

    it("devolve true para um Vídeo já gravado e false para um desconhecido", () => {
      const ledger = makeLedger();
      makeChannelWithVideo(ledger);

      expect(ledger.hasVideo("v1")).toBe(true);
      expect(ledger.hasVideo("v2")).toBe(false);
    });
  });

  describe("comment_absences", () => {
    function makeChannelWithVideos(ledger: SqliteLedger) {
      ledger.createChannel({
        channelId: CHANNEL_ID,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      for (const id of ["v1", "v2"]) {
        ledger.upsertVideo({
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

    it("marca um Vídeo sem Comentários (desativados/vazio) e o lista como ausência", () => {
      const ledger = makeLedger();
      makeChannelWithVideos(ledger);

      ledger.markCommentAbsence("v1", "disabled");
      ledger.markCommentAbsence("v2", "none");

      expect(ledger.listCommentAbsences(CHANNEL_ID)).toEqual(["v1", "v2"]);
    });

    it("é idempotente ao marcar a mesma ausência de novo", () => {
      const ledger = makeLedger();
      makeChannelWithVideos(ledger);

      ledger.markCommentAbsence("v1", "disabled");
      ledger.markCommentAbsence("v1", "disabled");

      expect(ledger.listCommentAbsences(CHANNEL_ID)).toEqual(["v1"]);
    });

    it("clearCommentAbsence remove a marcação", () => {
      const ledger = makeLedger();
      makeChannelWithVideos(ledger);
      ledger.markCommentAbsence("v1", "none");

      ledger.clearCommentAbsence("v1");

      expect(ledger.listCommentAbsences(CHANNEL_ID)).toEqual([]);
    });

    it("devolve lista vazia quando nenhum Vídeo está com Comentários ausentes", () => {
      const ledger = makeLedger();
      makeChannelWithVideos(ledger);

      expect(ledger.listCommentAbsences(CHANNEL_ID)).toEqual([]);
    });
  });

  describe("hasCommentIngestion", () => {
    function makeChannelWithVideo(ledger: SqliteLedger) {
      ledger.createChannel({
        channelId: CHANNEL_ID,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      ledger.upsertVideo({
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

    it("devolve true quando o Vídeo tem Comentários gravados", () => {
      const ledger = makeLedger();
      makeChannelWithVideo(ledger);
      ledger.upsertComment({
        id: "c1",
        videoId: "v1",
        channelId: CHANNEL_ID,
        videoTitle: "Primeiro vídeo",
        author: "Gato Funky",
        text: "Primeiro comentário",
        likes: 42,
        publishedAt: "2023-01-02T00:00:00Z",
      });

      expect(ledger.hasCommentIngestion("v1")).toBe(true);
    });

    it("devolve true quando o Vídeo tem ausência de Comentários marcada", () => {
      const ledger = makeLedger();
      makeChannelWithVideo(ledger);
      ledger.markCommentAbsence("v1", "disabled");

      expect(ledger.hasCommentIngestion("v1")).toBe(true);
    });

    it("devolve false quando nada foi ingerido para o Vídeo", () => {
      const ledger = makeLedger();
      makeChannelWithVideo(ledger);

      expect(ledger.hasCommentIngestion("v1")).toBe(false);
    });
  });

  describe("deleteCommentsForVideo", () => {
    it("remove apenas os Comentários do Vídeo indicado", () => {
      const ledger = makeLedger();
      ledger.createChannel({
        channelId: CHANNEL_ID,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      for (const id of ["v1", "v2"]) {
        ledger.upsertVideo({
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
      ledger.upsertComment({
        id: "c1",
        videoId: "v1",
        channelId: CHANNEL_ID,
        videoTitle: "Vídeo v1",
        author: "A",
        text: "Comentário de v1",
        likes: 1,
        publishedAt: "2023-01-02T00:00:00Z",
      });
      ledger.upsertComment({
        id: "c2",
        videoId: "v2",
        channelId: CHANNEL_ID,
        videoTitle: "Vídeo v2",
        author: "B",
        text: "Comentário de v2",
        likes: 2,
        publishedAt: "2023-01-03T00:00:00Z",
      });

      ledger.deleteCommentsForVideo("v1");

      expect(ledger.listComments(CHANNEL_ID).map((c) => c.id)).toEqual(["c2"]);
    });
  });

  describe("hasTranscriptIngestion", () => {
    function makeChannelWithVideo(ledger: SqliteLedger) {
      ledger.createChannel({
        channelId: CHANNEL_ID,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      ledger.upsertVideo({
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

    it("devolve true quando o Vídeo tem Segmentos de Transcrição gravados", () => {
      const ledger = makeLedger();
      makeChannelWithVideo(ledger);
      ledger.upsertTranscriptSegment({
        id: "v1:0",
        videoId: "v1",
        channelId: CHANNEL_ID,
        videoTitle: "Primeiro vídeo",
        videoPublishedAt: "2023-01-01T00:00:00Z",
        start: 0,
        end: 10,
        text: "trecho",
      });

      expect(ledger.hasTranscriptIngestion("v1")).toBe(true);
    });

    it("devolve true quando o Vídeo tem ausência de Transcrição marcada", () => {
      const ledger = makeLedger();
      makeChannelWithVideo(ledger);
      ledger.markTranscriptAbsent("v1");

      expect(ledger.hasTranscriptIngestion("v1")).toBe(true);
    });

    it("devolve false quando nada foi ingerido para o Vídeo", () => {
      const ledger = makeLedger();
      makeChannelWithVideo(ledger);

      expect(ledger.hasTranscriptIngestion("v1")).toBe(false);
    });
  });
});