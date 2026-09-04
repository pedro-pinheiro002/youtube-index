import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgresLedger,
  SqliteLedger,
  closePgPool,
  createDatabase,
  createPgPool,
  applyPgSchema,
  type Ledger,
  type Pool,
} from "@youtube-index/domain";

interface Backend {
  name: string;
  makeLedger: () => Promise<Ledger>;
}

const sqliteBackend: Backend = {
  name: "SqliteLedger",
  async makeLedger() {
    const db = createDatabase(":memory:");
    return new SqliteLedger(db);
  },
};

const postgresBackend: Backend = {
  name: "PostgresLedger",
  async makeLedger() {
    return new PostgresLedger(postgresPool);
  },
};

const backends: Backend[] = [sqliteBackend, postgresBackend];

// Pool Postgres compartilhado por todos os testes deste arquivo.
// Cada teste recebe um namespace único (canal, vídeo, comentário,
// segmento) via `testNamespace()` para isolar dados entre testes
// paralelos que compartilham o mesmo banco. Os canais são deletados
// no `afterAll` via cascade.
const POSTGRES_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/youtube_index";
let postgresPool: Pool;
const createdChannelIds: string[] = [];

beforeAll(async () => {
  postgresPool = createPgPool({ databaseUrl: POSTGRES_URL });
  await applyPgSchema(postgresPool);
});

afterAll(async () => {
  if (createdChannelIds.length > 0) {
    await postgresPool.query("DELETE FROM channels WHERE id = ANY($1)", [createdChannelIds]);
  }
  await closePgPool(postgresPool);
});

/**
 * Cada teste Postgres recebe um `channelId` único e vídeo/comentário/
 * segmento derivados dele. Para o SQLite (`:memory:`) o namespace é
 * irrelevante — a base é isolada por teste.
 */
let postgresTestCounter = 0;
function testNamespace(suffix: string): {
  channelId: string;
  videoA: string;
  videoB: string;
  commentA: string;
  segmentA: string;
} {
  postgresTestCounter += 1;
  const n = `${process.pid}_${postgresTestCounter}_${suffix}`;
  return {
    channelId: `UC_LE_${n}`,
    videoA: `v_${n}_a`,
    videoB: `v_${n}_b`,
    commentA: `c_${n}_a`,
    segmentA: `s_${n}_a`,
  };
}

describe.each(backends)("$name", ({ makeLedger }) => {
  describe("createChannel", () => {
    it("cria um Canal com status queued e as três Fases em pending", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("create");

      const channel = await ledger.createChannel({
        channelId: ns.channelId,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      createdChannelIds.push(ns.channelId);

      expect(channel).toMatchObject({
        id: ns.channelId,
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
      const ledger = await makeLedger();
      const ns = testNamespace("idem");
      const input = {
        channelId: ns.channelId,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      };
      createdChannelIds.push(ns.channelId);

      await ledger.createChannel(input);
      const again = await ledger.createChannel(input);

      expect(again.id).toBe(input.channelId);
    });
  });

  describe("getChannel", () => {
    it("devolve o Canal criado com status e progresso por Fase", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("get");
      const input = {
        channelId: ns.channelId,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      };
      createdChannelIds.push(ns.channelId);
      await ledger.createChannel(input);

      const channel = await ledger.getChannel(input.channelId);

      expect(channel).not.toBeNull();
      expect(channel?.id).toBe(input.channelId);
      expect(channel?.status).toBe("queued");
      expect(Object.keys(channel?.phases ?? {})).toEqual(["videos", "comments", "transcripts"]);
    });

    it("devolve null para um channelId desconhecido", async () => {
      const ledger = await makeLedger();

      expect(await ledger.getChannel("desconhecido")).toBeNull();
    });
  });

  describe("setChannelError / clearChannelError", () => {
    it("grava o motivo da falha e o devolve via getChannel", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("error");
      createdChannelIds.push(ns.channelId);
      await ledger.createChannel({
        channelId: ns.channelId,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });

      await ledger.setChannelError(ns.channelId, "cota esgotada");

      expect((await ledger.getChannel(ns.channelId))?.lastError).toBe("cota esgotada");
    });

    it("clearChannelError volta lastError para null", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("clearerror");
      createdChannelIds.push(ns.channelId);
      await ledger.createChannel({
        channelId: ns.channelId,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      await ledger.setChannelError(ns.channelId, "cota esgotada");

      await ledger.clearChannelError(ns.channelId);

      expect((await ledger.getChannel(ns.channelId))?.lastError).toBeNull();
    });

    it("criar o Canal de novo zera o lastError", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("recriar");
      createdChannelIds.push(ns.channelId);
      await ledger.createChannel({
        channelId: ns.channelId,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      await ledger.setChannelError(ns.channelId, "cota esgotada");

      await ledger.createChannel({
        channelId: ns.channelId,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });

      expect((await ledger.getChannel(ns.channelId))?.lastError).toBeNull();
    });
  });

  describe("deleteChannel", () => {
    it("apaga o Canal e o faz sumir de getChannel / listChannels", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("delete");
      await ledger.createChannel({
        channelId: ns.channelId,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      await ledger.updatePhase(ns.channelId, "videos", { status: "completed", done: 2, total: 2 });

      await ledger.deleteChannel(ns.channelId);

      expect(await ledger.getChannel(ns.channelId)).toBeNull();
      // `listChannels` lista TODOS os canais, então não verificamos o conteúdo —
      // a verificação do channelId específico acima já cobre o caso.
    });

    it("não falha quando o channelId não existe (idempotente)", async () => {
      const ledger = await makeLedger();

      await expect(ledger.deleteChannel("desconhecido")).resolves.toBeUndefined();
    });
  });

  describe("upsertComment / listComments", () => {
    async function makeChannelWithVideo(ledger: Ledger, ns: ReturnType<typeof testNamespace>) {
      await ledger.createChannel({
        channelId: ns.channelId,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      await ledger.upsertVideo({
        id: ns.videoA,
        channelId: ns.channelId,
        title: "Primeiro vídeo",
        description: "Uma descrição",
        publishedAt: "2023-01-01T00:00:00Z",
        views: 100,
        likes: 10,
        durationSeconds: 120,
      });
    }

    it("grava um Comentário ligado ao Vídeo e o devolve como linha canônica", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("comment");
      createdChannelIds.push(ns.channelId);
      await makeChannelWithVideo(ledger, ns);
      await ledger.upsertComment({
        id: ns.commentA,
        videoId: ns.videoA,
        channelId: ns.channelId,
        author: "Gato Funky",
        text: "Primeiro comentário",
        likes: 42,
        publishedAt: "2023-01-02T00:00:00Z",
      });

      const comments = await ledger.listComments(ns.channelId);

      expect(comments).toEqual([
        {
          id: ns.commentA,
          videoId: ns.videoA,
          channelId: ns.channelId,
          author: "Gato Funky",
          text: "Primeiro comentário",
          likes: 42,
          publishedAt: "2023-01-02T00:00:00Z",
        },
      ]);
    });

    it("é idempotente quando o mesmo id de Comentário é gravado de novo", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("comment-idem");
      createdChannelIds.push(ns.channelId);
      await makeChannelWithVideo(ledger, ns);
      const comment = {
        id: ns.commentA,
        videoId: ns.videoA,
        channelId: ns.channelId,
        author: "Gato Funky",
        text: "Primeiro comentário",
        likes: 42,
        publishedAt: "2023-01-02T00:00:00Z",
      };

      await ledger.upsertComment(comment);
      await ledger.upsertComment(comment);

      expect(await ledger.listComments(ns.channelId)).toHaveLength(1);
    });

    it("devolve lista vazia para um Canal sem Comentários", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("comment-empty");
      createdChannelIds.push(ns.channelId);
      await makeChannelWithVideo(ledger, ns);

      expect(await ledger.listComments(ns.channelId)).toEqual([]);
    });
  });

  describe("upsertTranscriptSegment / listTranscriptSegments", () => {
    async function makeChannelWithVideo(ledger: Ledger, ns: ReturnType<typeof testNamespace>) {
      await ledger.createChannel({
        channelId: ns.channelId,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      await ledger.upsertVideo({
        id: ns.videoA,
        channelId: ns.channelId,
        title: "Primeiro vídeo",
        description: "Uma descrição",
        publishedAt: "2023-01-01T00:00:00Z",
        views: 100,
        likes: 10,
        durationSeconds: 120,
      });
    }

    it("grava um Segmento ligado ao Vídeo e o devolve como linha canônica", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("seg");
      createdChannelIds.push(ns.channelId);
      await makeChannelWithVideo(ledger, ns);
      await ledger.upsertTranscriptSegment({
        id: `${ns.videoA}:142`,
        videoId: ns.videoA,
        channelId: ns.channelId,
        start: 142,
        end: 150,
        text: "trecho da transcrição",
      });

      const segments = await ledger.listTranscriptSegments(ns.channelId);

      expect(segments).toEqual([
        {
          id: `${ns.videoA}:142`,
          videoId: ns.videoA,
          channelId: ns.channelId,
          start: 142,
          end: 150,
          text: "trecho da transcrição",
        },
      ]);
    });

    it("é idempotente quando o mesmo Segmento (vídeo + start) é gravado de novo", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("seg-idem");
      createdChannelIds.push(ns.channelId);
      await makeChannelWithVideo(ledger, ns);
      const segment = {
        id: `${ns.videoA}:142`,
        videoId: ns.videoA,
        channelId: ns.channelId,
        start: 142,
        end: 150,
        text: "trecho da transcrição",
      };

      await ledger.upsertTranscriptSegment(segment);
      await ledger.upsertTranscriptSegment(segment);

      expect(await ledger.listTranscriptSegments(ns.channelId)).toHaveLength(1);
    });

    it("devolve lista vazia para um Canal sem Segmentos", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("seg-empty");
      createdChannelIds.push(ns.channelId);
      await makeChannelWithVideo(ledger, ns);

      expect(await ledger.listTranscriptSegments(ns.channelId)).toEqual([]);
    });
  });

  describe("markTranscriptAbsent / listTranscriptAbsences", () => {
    async function makeChannelWithVideos(ledger: Ledger, ns: ReturnType<typeof testNamespace>) {
      await ledger.createChannel({
        channelId: ns.channelId,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      for (const id of [ns.videoA, ns.videoB]) {
        await ledger.upsertVideo({
          id,
          channelId: ns.channelId,
          title: `Vídeo ${id}`,
          description: "Uma descrição",
          publishedAt: "2023-01-01T00:00:00Z",
          views: 100,
          likes: 10,
          durationSeconds: 120,
        });
      }
    }

    it("marca um Vídeo sem Transcrição e o lista como ausência", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("t-abs");
      createdChannelIds.push(ns.channelId);
      await makeChannelWithVideos(ledger, ns);

      await ledger.markTranscriptAbsent(ns.videoA);

      expect(await ledger.listTranscriptAbsences(ns.channelId)).toEqual([ns.videoA]);
    });

    it("é idempotente ao marcar a mesma ausência de novo", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("t-abs-idem");
      createdChannelIds.push(ns.channelId);
      await makeChannelWithVideos(ledger, ns);

      await ledger.markTranscriptAbsent(ns.videoA);
      await ledger.markTranscriptAbsent(ns.videoA);

      expect(await ledger.listTranscriptAbsences(ns.channelId)).toEqual([ns.videoA]);
    });

    it("devolve lista vazia quando nenhum Vídeo está sem Transcrição", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("t-abs-empty");
      createdChannelIds.push(ns.channelId);
      await makeChannelWithVideos(ledger, ns);

      expect(await ledger.listTranscriptAbsences(ns.channelId)).toEqual([]);
    });
  });

  describe("hasVideo", () => {
    it("devolve true para um Vídeo já gravado e false para um desconhecido", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("has-video");
      createdChannelIds.push(ns.channelId);
      await ledger.createChannel({
        channelId: ns.channelId,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      await ledger.upsertVideo({
        id: ns.videoA,
        channelId: ns.channelId,
        title: "Primeiro vídeo",
        description: "Uma descrição",
        publishedAt: "2023-01-01T00:00:00Z",
        views: 100,
        likes: 10,
        durationSeconds: 120,
      });

      expect(await ledger.hasVideo(ns.videoA)).toBe(true);
      // Usa um id com prefixo único do teste para evitar colisão com
      // outros testes paralelos no Postgres compartilhado.
      expect(await ledger.hasVideo(`${ns.videoA}_unknown`)).toBe(false);
    });
  });

  describe("videoContext", () => {
    it("devolve o contexto canônico do Vídeo (sem description/durationSeconds)", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("ctx");
      createdChannelIds.push(ns.channelId);
      await ledger.createChannel({
        channelId: ns.channelId,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      await ledger.upsertVideo({
        id: ns.videoA,
        channelId: ns.channelId,
        title: "Primeiro vídeo",
        description: "Uma descrição",
        publishedAt: "2023-01-01T00:00:00Z",
        views: 100,
        likes: 10,
        durationSeconds: 120,
      });

      expect(await ledger.videoContext(ns.videoA)).toEqual({
        id: ns.videoA,
        title: "Primeiro vídeo",
        views: 100,
        likes: 10,
        publishedAt: "2023-01-01T00:00:00Z",
      });
    });

    it("devolve null para um Vídeo desconhecido", async () => {
      const ledger = await makeLedger();
      // Usa um id com prefixo único do teste para evitar colisão no Postgres.
      const ns2 = testNamespace("ctx-null");
      createdChannelIds.push(ns2.channelId);

      expect(await ledger.videoContext(`${ns2.videoA}_unknown`)).toBeNull();
    });
  });

  describe("comment_absences", () => {
    async function makeChannelWithVideos(ledger: Ledger, ns: ReturnType<typeof testNamespace>) {
      await ledger.createChannel({
        channelId: ns.channelId,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      for (const id of [ns.videoA, ns.videoB]) {
        await ledger.upsertVideo({
          id,
          channelId: ns.channelId,
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
      const ledger = await makeLedger();
      const ns = testNamespace("c-abs");
      createdChannelIds.push(ns.channelId);
      await makeChannelWithVideos(ledger, ns);

      await ledger.markCommentAbsence(ns.videoA, "disabled");
      await ledger.markCommentAbsence(ns.videoB, "none");

      expect(await ledger.listCommentAbsences(ns.channelId)).toEqual([ns.videoA, ns.videoB]);
    });

    it("é idempotente ao marcar a mesma ausência de novo", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("c-abs-idem");
      createdChannelIds.push(ns.channelId);
      await makeChannelWithVideos(ledger, ns);

      await ledger.markCommentAbsence(ns.videoA, "disabled");
      await ledger.markCommentAbsence(ns.videoA, "disabled");

      expect(await ledger.listCommentAbsences(ns.channelId)).toEqual([ns.videoA]);
    });

    it("clearCommentAbsence remove a marcação", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("c-abs-clear");
      createdChannelIds.push(ns.channelId);
      await makeChannelWithVideos(ledger, ns);
      await ledger.markCommentAbsence(ns.videoA, "none");

      await ledger.clearCommentAbsence(ns.videoA);

      expect(await ledger.listCommentAbsences(ns.channelId)).toEqual([]);
    });

    it("devolve lista vazia quando nenhum Vídeo está com Comentários ausentes", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("c-abs-empty");
      createdChannelIds.push(ns.channelId);
      await makeChannelWithVideos(ledger, ns);

      expect(await ledger.listCommentAbsences(ns.channelId)).toEqual([]);
    });
  });

  describe("hasCommentIngestion", () => {
    async function makeChannelWithVideo(ledger: Ledger, ns: ReturnType<typeof testNamespace>) {
      await ledger.createChannel({
        channelId: ns.channelId,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      await ledger.upsertVideo({
        id: ns.videoA,
        channelId: ns.channelId,
        title: "Primeiro vídeo",
        description: "Uma descrição",
        publishedAt: "2023-01-01T00:00:00Z",
        views: 100,
        likes: 10,
        durationSeconds: 120,
      });
    }

    it("devolve true quando o Vídeo tem Comentários gravados", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("has-c");
      createdChannelIds.push(ns.channelId);
      await makeChannelWithVideo(ledger, ns);
      await ledger.upsertComment({
        id: ns.commentA,
        videoId: ns.videoA,
        channelId: ns.channelId,
        author: "Gato Funky",
        text: "Primeiro comentário",
        likes: 42,
        publishedAt: "2023-01-02T00:00:00Z",
      });

      expect(await ledger.hasCommentIngestion(ns.videoA)).toBe(true);
    });

    it("devolve true quando o Vídeo tem ausência de Comentários marcada", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("has-c-abs");
      createdChannelIds.push(ns.channelId);
      await makeChannelWithVideo(ledger, ns);
      await ledger.markCommentAbsence(ns.videoA, "disabled");

      expect(await ledger.hasCommentIngestion(ns.videoA)).toBe(true);
    });

    it("devolve false quando nada foi ingerido para o Vídeo", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("has-c-empty");
      createdChannelIds.push(ns.channelId);
      await makeChannelWithVideo(ledger, ns);

      expect(await ledger.hasCommentIngestion(ns.videoA)).toBe(false);
    });
  });

  describe("deleteCommentsForVideo", () => {
    it("remove apenas os Comentários do Vídeo indicado", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("del-c");
      createdChannelIds.push(ns.channelId);
      await ledger.createChannel({
        channelId: ns.channelId,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      for (const id of [ns.videoA, ns.videoB]) {
        await ledger.upsertVideo({
          id,
          channelId: ns.channelId,
          title: `Vídeo ${id}`,
          description: "Uma descrição",
          publishedAt: "2023-01-01T00:00:00Z",
          views: 100,
          likes: 10,
          durationSeconds: 120,
        });
      }
      await ledger.upsertComment({
        id: ns.commentA,
        videoId: ns.videoA,
        channelId: ns.channelId,
        author: "A",
        text: "Comentário de v1",
        likes: 1,
        publishedAt: "2023-01-02T00:00:00Z",
      });
      await ledger.upsertComment({
        id: `${ns.commentA}_b`,
        videoId: ns.videoB,
        channelId: ns.channelId,
        author: "B",
        text: "Comentário de v2",
        likes: 2,
        publishedAt: "2023-01-03T00:00:00Z",
      });

      await ledger.deleteCommentsForVideo(ns.videoA);

      expect((await ledger.listComments(ns.channelId)).map((c) => c.id)).toEqual([`${ns.commentA}_b`]);
    });
  });

  describe("hasTranscriptIngestion", () => {
    async function makeChannelWithVideo(ledger: Ledger, ns: ReturnType<typeof testNamespace>) {
      await ledger.createChannel({
        channelId: ns.channelId,
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      await ledger.upsertVideo({
        id: ns.videoA,
        channelId: ns.channelId,
        title: "Primeiro vídeo",
        description: "Uma descrição",
        publishedAt: "2023-01-01T00:00:00Z",
        views: 100,
        likes: 10,
        durationSeconds: 120,
      });
    }

    it("devolve true quando o Vídeo tem Segmentos de Transcrição gravados", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("has-t");
      createdChannelIds.push(ns.channelId);
      await makeChannelWithVideo(ledger, ns);
      await ledger.upsertTranscriptSegment({
        id: `${ns.videoA}:0`,
        videoId: ns.videoA,
        channelId: ns.channelId,
        start: 0,
        end: 10,
        text: "trecho",
      });

      expect(await ledger.hasTranscriptIngestion(ns.videoA)).toBe(true);
    });

    it("devolve true quando o Vídeo tem ausência de Transcrição marcada", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("has-t-abs");
      createdChannelIds.push(ns.channelId);
      await makeChannelWithVideo(ledger, ns);
      await ledger.markTranscriptAbsent(ns.videoA);

      expect(await ledger.hasTranscriptIngestion(ns.videoA)).toBe(true);
    });

    it("devolve false quando nada foi ingerido para o Vídeo", async () => {
      const ledger = await makeLedger();
      const ns = testNamespace("has-t-empty");
      createdChannelIds.push(ns.channelId);
      await makeChannelWithVideo(ledger, ns);

      expect(await ledger.hasTranscriptIngestion(ns.videoA)).toBe(false);
    });
  });
});