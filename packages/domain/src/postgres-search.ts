import type pg from "pg";
import type { SearchHit, SearchParams, SearchPort, SearchResponse, SearchSort } from "./search.js";
import type { Documento, Projection, ProjectionHit, SearchDocumentType } from "./documento.js";
import { toCommentDocument, toSegmentDocument, toVideoDocument } from "./documento.js";
import { PostgresLedger } from "./postgres-ledger.js";
import type { VideoContext } from "./ledger.js";

const DEFAULT_LIMIT = 20;
const TRGM_SIMILARITY_THRESHOLD = 0.3;

interface VideoRow {
  id: string;
  channel_id: string;
  title: string;
  description: string;
  published_at: string;
  views: string | number | null;
  likes: string | number | null;
  duration_seconds: number | null;
}

interface CommentRow {
  id: string;
  video_id: string;
  channel_id: string;
  author: string;
  text: string;
  likes: string | number | null;
  published_at: string;
  video_title: string;
  video_views: string | number | null;
  video_likes: string | number | null;
}

interface SegmentRow {
  id: string;
  video_id: string;
  channel_id: string;
  start_seconds: string | number;
  end_seconds: string | number;
  text: string;
  video_title: string;
  video_views: string | number | null;
  video_likes: string | number | null;
  video_published_at: string;
}

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  return typeof value === "number" ? value : Number(value);
}

/**
 * Implementação Postgres da `SearchPort`. Substitui `MeilisearchProjection`
 * (slice #45): lê dos mesmos Vídeos/Comentários/Segmentos que a `Ledger`
 * grava, usando `tsvector @@ websearch_to_tsquery` ranqueado por `ts_rank`
 * no caminho lexical e `pg_trgm` similarity no fallback de typo.
 *
 * `websearch_to_tsquery` (e não `plainto_tsquery`) é usado porque ele
 * entende a sintaxe informal de busca (`gato OR strogonoff`,
 * `"comportamento felino"`, `-ruim`) que a UI já envia, mantendo a
 * forma da resposta que o frontend consumia do Meilisearch.
 *
 * Caminho lexical (Documento casa):
 *   `WHERE fts @@ websearch_to_tsquery('english', $q) ORDER BY ts_rank(...) DESC`
 *
 * Fallback de typo (somente quando o lexical retorna zero hits):
 *   `WHERE similarity(<coluna textual>, $q) > 0.3 ORDER BY similarity(...) DESC`
 *
 * O destaque vem de `ts_headline('english', <text>, tsquery,
 * 'StartSel=<em>,StopSel=</em>')` aplicado nas colunas textuais de cada
 * tabela, e a forma de Documento final é composta pelos mappers do
 * domínio (`toVideoDocument`, `toCommentDocument`, `toSegmentDocument`)
 * para preservar a resposta que a UI já consome.
 */
export class PostgresSearchProjection implements SearchPort, Projection {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  /**
   * No-op de `Projection`: no caminho Postgres os Documentos são
   * materializados nas próprias tabelas pelo `PostgresLedger` (colunas
   * `fts` geradas a partir de `title`/`description`/`text`). Em slice
   * #46 o `Ingestion` deixa de chamar `projection.*` por completo.
   */
  async addDocuments(_channelId: string, _documents: Documento[]): Promise<void> {
    return;
  }

  async remove(
    _channelId: string,
    _predicate: (hit: ProjectionHit) => boolean,
  ): Promise<void> {
    return;
  }

  async clear(_channelId: string): Promise<void> {
    return;
  }

  async search(params: SearchParams): Promise<SearchResponse> {
    const limit = params.limit ?? DEFAULT_LIMIT;
    const channelId = params.channelId;

    const lexicalHits = await this.runLexical(params, channelId, limit);
    if (lexicalHits.length > 0) {
      return {
        hits: lexicalHits,
        total: lexicalHits.length,
        query: params.q,
      };
    }

    // Fallback de typo: só dispara quando o lexical não casa. Não
    // compomos scores — é uma segunda chance, não um blend (ADR-0005).
    const trgmHits = await this.runTrgmFallback(params, channelId, limit);
    return {
      hits: trgmHits,
      total: trgmHits.length,
      query: params.q,
    };
  }

  private async runLexical(
    params: SearchParams,
    channelId: string,
    limit: number,
  ): Promise<SearchHit[]> {
    const tipo = params.tipo;
    const sort: SearchSort = params.sort ?? "relevance";
    const targets: readonly SearchDocumentType[] = tipo
      ? [tipo]
      : (["video", "comment", "segment"] as const);

    const results: Array<{ hit: SearchHit; rank: number; publishedAt: string }> = [];

    for (const target of targets) {
      if (target === "video") {
        const rows = await this.queryVideosLexical(params.q, channelId, sort, limit);
        for (const row of rows) {
          const formatted = { title: row.title_headline, description: row.description_headline };
          const doc = toVideoDocument({
            id: row.id,
            channelId: row.channel_id,
            title: row.title,
            description: row.description,
            publishedAt: row.published_at,
            views: toNumber(row.views),
            likes: toNumber(row.likes),
            durationSeconds: row.duration_seconds ?? 0,
          });
          results.push({
            hit: { ...doc, _formatted: formatted },
            rank: row.rank,
            publishedAt: row.published_at,
          });
        }
      } else if (target === "comment") {
        const rows = await this.queryCommentsLexical(params.q, channelId, sort, limit);
        for (const row of rows) {
          const formatted = { text: row.text_headline, author: row.author_headline };
          const doc = toCommentDocument(
            {
              id: row.id,
              videoId: row.video_id,
              channelId: row.channel_id,
              author: row.author,
              text: row.text,
              likes: toNumber(row.likes),
              publishedAt: row.published_at,
            },
            {
              id: row.video_id,
              title: row.video_title,
              views: toNumber(row.video_views),
              likes: toNumber(row.video_likes),
              publishedAt: row.published_at,
            },
          );
          results.push({
            hit: { ...doc, _formatted: formatted },
            rank: row.rank,
            publishedAt: row.published_at,
          });
        }
      } else if (target === "segment") {
        const rows = await this.querySegmentsLexical(params.q, channelId, sort, limit);
        for (const row of rows) {
          const formatted = { text: row.text_headline };
          const doc = toSegmentDocument(
            {
              id: `${row.video_id}:${row.start_seconds}`,
              videoId: row.video_id,
              channelId: row.channel_id,
              start: Number(row.start_seconds),
              end: Number(row.end_seconds),
              text: row.text,
            },
            {
              id: row.video_id,
              title: row.video_title,
              views: toNumber(row.video_views),
              likes: toNumber(row.video_likes),
              publishedAt: row.video_published_at,
            },
          );
          results.push({
            hit: { ...doc, _formatted: formatted },
            rank: row.rank,
            publishedAt: row.video_published_at,
          });
        }
      }
    }

    if (sort === "publishedAt") {
      results.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    } else {
      results.sort((a, b) => b.rank - a.rank);
    }

    return results.slice(0, limit).map((r) => r.hit);
  }

  private async runTrgmFallback(
    params: SearchParams,
    channelId: string,
    limit: number,
  ): Promise<SearchHit[]> {
    const tipo = params.tipo;
    const sort: SearchSort = params.sort ?? "relevance";
    const targets: readonly SearchDocumentType[] = tipo
      ? [tipo]
      : (["video", "comment", "segment"] as const);

    // O pool de VideoContext é construído preguiçosamente para
    // preencher `videoTitle/videoUrl/...` nos Documentos de Comentário e
    // Segmento via os mappers do domínio.
    const ctx = new PostgresLedger(this.pool);
    const videoContextCache = new Map<string, VideoContext | null>();

    async function getContext(videoId: string): Promise<VideoContext | null> {
      if (!videoContextCache.has(videoId)) {
        videoContextCache.set(videoId, await ctx.videoContext(videoId));
      }
      return videoContextCache.get(videoId) ?? null;
    }

    const results: Array<{ hit: SearchHit; similarity: number; publishedAt: string }> = [];

    for (const target of targets) {
      if (target === "video") {
        const rows = await this.queryVideosTrgm(params.q, channelId, limit);
        for (const row of rows) {
          const doc = toVideoDocument({
            id: row.id,
            channelId: row.channel_id,
            title: row.title,
            description: row.description,
            publishedAt: row.published_at,
            views: toNumber(row.views),
            likes: toNumber(row.likes),
            durationSeconds: row.duration_seconds ?? 0,
          });
          results.push({
            hit: { ...doc, _formatted: { title: row.title, description: row.description } },
            similarity: row.similarity,
            publishedAt: row.published_at,
          });
        }
      } else if (target === "comment") {
        const rows = await this.queryCommentsTrgm(params.q, channelId, limit);
        for (const row of rows) {
          const context = await getContext(row.video_id);
          if (!context) {
            continue;
          }
          const doc = toCommentDocument(
            {
              id: row.id,
              videoId: row.video_id,
              channelId: row.channel_id,
              author: row.author,
              text: row.text,
              likes: toNumber(row.likes),
              publishedAt: row.published_at,
            },
            context,
          );
          results.push({
            hit: { ...doc, _formatted: { text: row.text, author: row.author } },
            similarity: row.similarity,
            publishedAt: row.published_at,
          });
        }
      } else if (target === "segment") {
        const rows = await this.querySegmentsTrgm(params.q, channelId, limit);
        for (const row of rows) {
          const context = await getContext(row.video_id);
          if (!context) {
            continue;
          }
          const doc = toSegmentDocument(
            {
              id: `${row.video_id}:${row.start_seconds}`,
              videoId: row.video_id,
              channelId: row.channel_id,
              start: Number(row.start_seconds),
              end: Number(row.end_seconds),
              text: row.text,
            },
            context,
          );
          results.push({
            hit: { ...doc, _formatted: { text: row.text } },
            similarity: row.similarity,
            publishedAt: row.video_published_at,
          });
        }
      }
    }

    if (sort === "publishedAt") {
      results.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    } else {
      results.sort((a, b) => b.similarity - a.similarity);
    }
    return results.slice(0, limit).map((r) => r.hit);
  }

  private async queryVideosLexical(
    q: string,
    channelId: string,
    sort: SearchSort,
    limit: number,
  ): Promise<
    Array<VideoRow & { rank: number; title_headline: string; description_headline: string }>
  > {
    const orderBy =
      sort === "publishedAt" ? "v.published_at DESC" : "ts_rank(v.fts, tsq.q) DESC";
    const res = await this.pool.query<
      VideoRow & { rank: number; title_headline: string; description_headline: string }
    >(
      `WITH tsq AS (SELECT websearch_to_tsquery('english', $1) AS q)
       SELECT v.id, v.channel_id, v.title, v.description, v.published_at, v.views, v.likes,
              v.duration_seconds,
              ts_rank(v.fts, tsq.q)::float AS rank,
              ts_headline('english', v.title, tsq.q, 'StartSel=<em>,StopSel=</em>') AS title_headline,
              ts_headline('english', v.description, tsq.q, 'StartSel=<em>,StopSel=</em>') AS description_headline
       FROM videos v, tsq
       WHERE v.channel_id = $2 AND v.fts @@ tsq.q
       ORDER BY ${orderBy}
       LIMIT $3`,
      [q, channelId, limit],
    );
    return res.rows;
  }

  private async queryCommentsLexical(
    q: string,
    channelId: string,
    sort: SearchSort,
    limit: number,
  ): Promise<
    Array<
      CommentRow & { rank: number; text_headline: string; author_headline: string }
    >
  > {
    const orderBy =
      sort === "publishedAt" ? "c.published_at DESC" : "ts_rank(c.fts, tsq.q) DESC";
    const res = await this.pool.query<
      CommentRow & { rank: number; text_headline: string; author_headline: string }
    >(
      `WITH tsq AS (SELECT websearch_to_tsquery('english', $1) AS q)
       SELECT c.id, c.video_id, v.channel_id, c.author, c.text, c.likes, c.published_at,
              v.title AS video_title, v.views AS video_views, v.likes AS video_likes,
              ts_rank(c.fts, tsq.q)::float AS rank,
              ts_headline('english', c.text, tsq.q, 'StartSel=<em>,StopSel=</em>') AS text_headline,
              ts_headline('english', c.author, tsq.q, 'StartSel=<em>,StopSel=</em>') AS author_headline
       FROM comments c
       JOIN videos v ON v.id = c.video_id, tsq
       WHERE v.channel_id = $2 AND c.fts @@ tsq.q
       ORDER BY ${orderBy}
       LIMIT $3`,
      [q, channelId, limit],
    );
    return res.rows;
  }

  private async querySegmentsLexical(
    q: string,
    channelId: string,
    sort: SearchSort,
    limit: number,
  ): Promise<Array<SegmentRow & { rank: number; text_headline: string }>> {
    const orderBy = sort === "publishedAt" ? "v.published_at DESC" : "ts_rank(t.fts, tsq.q) DESC";
    const res = await this.pool.query<SegmentRow & { rank: number; text_headline: string }>(
      `WITH tsq AS (SELECT websearch_to_tsquery('english', $1) AS q)
       SELECT t.id, t.video_id, v.channel_id, t.start_seconds, t.end_seconds, t.text,
              v.title AS video_title, v.views AS video_views, v.likes AS video_likes,
              v.published_at AS video_published_at,
              ts_rank(t.fts, tsq.q)::float AS rank,
              ts_headline('english', t.text, tsq.q, 'StartSel=<em>,StopSel=</em>') AS text_headline
       FROM transcript_segments t
       JOIN videos v ON v.id = t.video_id, tsq
       WHERE v.channel_id = $2 AND t.fts @@ tsq.q
       ORDER BY ${orderBy}
       LIMIT $3`,
      [q, channelId, limit],
    );
    return res.rows;
  }

  private async queryVideosTrgm(
    q: string,
    channelId: string,
    limit: number,
  ): Promise<Array<VideoRow & { similarity: number }>> {
    const res = await this.pool.query<VideoRow & { similarity: number }>(
      `SELECT id, channel_id, title, description, published_at, views, likes, duration_seconds,
              GREATEST(similarity(title, $1), similarity(description, $1))::float AS similarity
       FROM videos
       WHERE channel_id = $2
         AND (similarity(title, $1) > $3 OR similarity(description, $1) > $3)
       ORDER BY GREATEST(similarity(title, $1), similarity(description, $1)) DESC
       LIMIT $4`,
      [q, channelId, TRGM_SIMILARITY_THRESHOLD, limit],
    );
    return res.rows;
  }

  private async queryCommentsTrgm(
    q: string,
    channelId: string,
    limit: number,
  ): Promise<Array<CommentRow & { similarity: number }>> {
    const res = await this.pool.query<CommentRow & { similarity: number }>(
      `SELECT c.id, c.video_id, v.channel_id, c.author, c.text, c.likes, c.published_at,
              v.title AS video_title, v.views AS video_views, v.likes AS video_likes,
              GREATEST(similarity(c.text, $1), similarity(c.author, $1))::float AS similarity
       FROM comments c
       JOIN videos v ON v.id = c.video_id
       WHERE v.channel_id = $2
         AND (similarity(c.text, $1) > $3 OR similarity(c.author, $1) > $3)
       ORDER BY GREATEST(similarity(c.text, $1), similarity(c.author, $1)) DESC
       LIMIT $4`,
      [q, channelId, TRGM_SIMILARITY_THRESHOLD, limit],
    );
    return res.rows;
  }

  private async querySegmentsTrgm(
    q: string,
    channelId: string,
    limit: number,
  ): Promise<Array<SegmentRow & { similarity: number }>> {
    const res = await this.pool.query<SegmentRow & { similarity: number }>(
      `SELECT t.id, t.video_id, v.channel_id, t.start_seconds, t.end_seconds, t.text,
              v.title AS video_title, v.views AS video_views, v.likes AS video_likes,
              v.published_at AS video_published_at,
              similarity(t.text, $1)::float AS similarity
       FROM transcript_segments t
       JOIN videos v ON v.id = t.video_id
       WHERE v.channel_id = $2
         AND similarity(t.text, $1) > $3
       ORDER BY similarity(t.text, $1) DESC
       LIMIT $4`,
      [q, channelId, TRGM_SIMILARITY_THRESHOLD, limit],
    );
    return res.rows;
  }
}
