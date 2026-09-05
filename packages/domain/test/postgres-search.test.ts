import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyPgSchema,
  closePgPool,
  createPgPool,
  PostgresLedger,
  PostgresSearchProjection,
  type Pool,
  type VideoRecord,
  type CommentRecord,
  type TranscriptSegmentRecord,
} from "@youtube-index/domain";

/**
 * Teste de integração da PostgresSearchProjection (slice #45): valida o
 * caminho lexical (`tsvector @@ plainto_tsquery ORDER BY ts_rank DESC`),
 * o destaque com `ts_headline` em `_formatted`, os filtros por `tipo` e
 * `channelId`, a ordenação por `publishedAt`, e o fallback de typo via
 * `pg_trgm` quando o caminho lexical não casa.
 *
 * Pré-requisito: Postgres acessível em DATABASE_URL (padrão
 * `postgres://postgres:postgres@localhost:5432/youtube_index`). O
 * schema é aplicado uma vez no `beforeAll` e os Canais são apagados
 * no `afterAll`.
 */

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/youtube_index";

let postgresTestCounter = 0;
function uniqueChannelId(suffix: string): string {
  postgresTestCounter += 1;
  return `UC_SEARCH_${process.pid}_${postgresTestCounter}_${suffix}`;
}

interface TestIds {
  channelId: string;
  videoA: string;
  videoB: string;
  commentId: string;
  segmentId: string;
}

function makeTestIds(suffix: string): TestIds {
  const counter = `${process.pid}_${++postgresTestCounter}`;
  return {
    channelId: `UC_SEARCH_${counter}_${suffix}`,
    videoA: `vs_${counter}_a`,
    videoB: `vs_${counter}_b`,
    commentId: `cs_${counter}_a`,
    segmentId: `ss_${counter}_a`,
  };
}

describe("POSTGRES PostgresSearchProjection (slice #45)", () => {
  let pool: Pool;
  const createdChannelIds: string[] = [];
  let search: PostgresSearchProjection;

  beforeAll(async () => {
    pool = createPgPool({ databaseUrl: DATABASE_URL });
    await applyPgSchema(pool);
    search = new PostgresSearchProjection(pool);
  });

  afterAll(async () => {
    if (createdChannelIds.length > 0) {
      await pool.query("DELETE FROM channels WHERE id = ANY($1)", [createdChannelIds]);
    }
    await closePgPool(pool);
  });

  async function seedChannel(ids: TestIds): Promise<void> {
    const ledger = new PostgresLedger(pool);
    await ledger.createChannel({
      channelId: ids.channelId,
      handle: "@search-slice",
      title: "Canal Search Slice",
    });
    const now = "2023-01-01T00:00:00Z";
    const videoA: VideoRecord = {
      id: ids.videoA,
      channelId: ids.channelId,
      title: "Como treinar um gato preto comportamento",
      description: "dicas de comportamento felino",
      publishedAt: "2023-01-01T00:00:00Z",
      views: 100,
      likes: 10,
      durationSeconds: 120,
    };
    const videoB: VideoRecord = {
      id: ids.videoB,
      channelId: ids.channelId,
      title: "Receita de strogonoff",
      description: "ingredientes e modo de preparo",
      publishedAt: "2023-01-02T00:00:00Z",
      views: 200,
      likes: 20,
      durationSeconds: 240,
    };
    await ledger.upsertVideo(videoA);
    await ledger.upsertVideo(videoB);
    const commentA: CommentRecord = {
      id: ids.commentId,
      videoId: ids.videoA,
      channelId: ids.channelId,
      author: "Gato Funky",
      text: "Adorei as dicas de comportamento",
      likes: 5,
      publishedAt: now,
    };
    await ledger.upsertComment(commentA);
    const segmentA: TranscriptSegmentRecord = {
      id: ids.segmentId,
      videoId: ids.videoA,
      channelId: ids.channelId,
      start: 0,
      end: 5,
      text: "Hoje vamos falar sobre gatos pretos",
    };
    await ledger.upsertTranscriptSegment(segmentA);
    createdChannelIds.push(ids.channelId);
  }

  it("retorna Vídeos que casam com a busca lexical", async () => {
    const ids = makeTestIds("lex-video");
    await seedChannel(ids);

    const result = await search.search({ q: "gato", channelId: ids.channelId, tipo: "video" });

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({
      id: ids.videoA,
      channelId: ids.channelId,
      type: "video",
      title: "Como treinar um gato preto comportamento",
    });
    expect(result.total).toBe(1);
    expect(result.query).toBe("gato");
  });

  it("retorna Vídeo com destaque (ts_headline) em title e description dentro de _formatted", async () => {
    const ids = makeTestIds("highlight");
    await seedChannel(ids);

    const result = await search.search({ q: "comportamento", channelId: ids.channelId });

    const gatoHit = result.hits.find((h) => h.id === ids.videoA);
    expect(gatoHit).toBeDefined();
    // O destaque deve envolver o termo casado em <em>...</em>.
    const formatted = (gatoHit as { _formatted?: Record<string, string> })._formatted;
    expect(formatted).toBeDefined();
    const titleFmt = formatted?.title ?? "";
    const descFmt = formatted?.description ?? "";
    expect(titleFmt).toContain("<em>");
    expect(titleFmt).toContain("</em>");
    expect(descFmt).toContain("<em>");
    expect(descFmt).toContain("</em>");
  });

  it("retorna Comentários quando tipo=comment", async () => {
    const ids = makeTestIds("lex-comment");
    await seedChannel(ids);

    const result = await search.search({ q: "comportamento", channelId: ids.channelId, tipo: "comment" });

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({
      id: ids.commentId,
      channelId: ids.channelId,
      type: "comment",
      videoId: ids.videoA,
      author: "Gato Funky",
      videoTitle: "Como treinar um gato preto comportamento",
    });
  });

  it("retorna Segmentos de Transcrição quando tipo=segment", async () => {
    const ids = makeTestIds("lex-segment");
    await seedChannel(ids);

    const result = await search.search({ q: "gato", channelId: ids.channelId, tipo: "segment" });

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({
      id: `${ids.videoA}:0`,
      channelId: ids.channelId,
      type: "segment",
      videoId: ids.videoA,
      start: 0,
      end: 5,
      url: `https://www.youtube.com/watch?v=${ids.videoA}&t=0s`,
    });
  });

  it("filtra por canal (não devolve Documentos de outros Canais)", async () => {
    const idsA = makeTestIds("scope-a");
    const idsB = makeTestIds("scope-b");
    await seedChannel(idsA);
    await seedChannel(idsB);

    const result = await search.search({ q: "gato", channelId: idsA.channelId });

    const channelIds = new Set(result.hits.map((h) => h.channelId));
    expect(channelIds.size).toBe(1);
    expect(channelIds.has(idsA.channelId)).toBe(true);
  });

  it("ordena por publishedAt quando sort=publishedAt", async () => {
    const ids = makeTestIds("sort");
    await seedChannel(ids);

    const result = await search.search({ q: "gato OR strogonoff", channelId: ids.channelId, sort: "publishedAt" });

    // Recebe pelo menos os 2 Vídeos que mencionam um dos termos. A ordem
    // deve ser do mais recente (strogonoff, 2023-01-02) para o mais antigo.
    const videoHits = result.hits.filter((h) => h.type === "video");
    expect(videoHits.length).toBeGreaterThanOrEqual(2);
    expect(videoHits[0]?.id).toBe(ids.videoB);
    expect(videoHits[1]?.id).toBe(ids.videoA);
  });

  it("retorna zero hits quando a busca não casa", async () => {
    const ids = makeTestIds("empty");
    await seedChannel(ids);

    const result = await search.search({ q: "xyzpalavrainexistente", channelId: ids.channelId });

    expect(result.hits).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("cai no fallback pg_trgm quando o caminho lexical não encontra nada", async () => {
    const ids = makeTestIds("typo");
    await seedChannel(ids);

    // "strogonofe" é um typo de "strogonoff" (1 caractere trocado). O
    // caminho lexical via tsvector não casa (stem diferente), mas o
    // trigrama 'tro' / 'rog' / 'ono' tem overlap alto o suficiente
    // para o similarity disparar.
    const result = await search.search({ q: "strogonofe", channelId: ids.channelId });

    expect(result.hits.length).toBeGreaterThanOrEqual(1);
    const strogonoffHit = result.hits.find((h) => h.id === ids.videoB);
    expect(strogonoffHit).toBeDefined();
    expect(strogonoffHit?.type).toBe("video");
  });

  it("filtra por tipo dentro do fallback pg_trgm", async () => {
    const ids = makeTestIds("typo-type");
    await seedChannel(ids);

    const result = await search.search({
      q: "comportamanto", // typo de "comportamento"
      channelId: ids.channelId,
      tipo: "comment",
    });

    // Deve trazer apenas o Comentário (que contém "comportamento") e
    // não o Segmento/Vídeo que também contém o termo.
    for (const hit of result.hits) {
      expect(hit.type).toBe("comment");
    }
    expect(result.hits.find((h) => h.id === ids.commentId)).toBeDefined();
  });

  it("limita resultados a `limit` quando informado", async () => {
    const ids = makeTestIds("limit");
    await seedChannel(ids);

    const result = await search.search({ q: "gato OR strogonoff", channelId: ids.channelId, limit: 1 });

    expect(result.hits.length).toBeLessThanOrEqual(1);
  });
});
