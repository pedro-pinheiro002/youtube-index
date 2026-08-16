import type { CommentRecord, TranscriptSegmentRecord, VideoContext, VideoRecord } from "./ledger.js";

/**
 * Os três tipos de Documento que vivem no Índice do Meilisearch,
 * discriminados pelo campo `type`. Juntas formam a união
 * {@link Documento}.
 */
export type SearchDocumentType = "video" | "comment" | "segment";

export interface VideoSearchDocument {
  id: string;
  channelId: string;
  type: "video";
  title: string;
  description: string;
  views: number;
  likes: number;
  durationSeconds: number;
  url: string;
  thumbnail: string;
  publishedAt: string;
}

export interface CommentSearchDocument {
  id: string;
  channelId: string;
  type: "comment";
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  videoThumbnail: string;
  videoViews: number;
  videoLikes: number;
  url: string;
  author: string;
  text: string;
  likes: number;
  publishedAt: string;
}

export interface SegmentSearchDocument {
  id: string;
  channelId: string;
  type: "segment";
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  videoThumbnail: string;
  videoViews: number;
  videoLikes: number;
  text: string;
  start: number;
  end: number;
  url: string;
  publishedAt: string;
}

/**
 * A união discriminada de Documentos que o Índice aceita.
 * Adicionar uma nova variante aqui é o único lugar que precisa
 * mudar para o type, o port, os mappers e a UI refletirem a forma.
 */
export type Documento = VideoSearchDocument | CommentSearchDocument | SegmentSearchDocument;

/** A porta de Projeção: como o domínio empurra Documentos para um Índice. */
export interface Projection {
  addDocuments(channelId: string, documents: Documento[]): Promise<void>;
  /**
   * Remove do Índice do Canal todos os Documentos que casam com o `predicate`.
   * Usado para varrer Documentos órfão durante a Sincronização (ex.: Vídeo
   * antigo que saiu do top-50 e teve seus Comentários apagados do Ledger).
   */
  remove(channelId: string, predicate: (doc: Documento) => boolean): Promise<void>;
  /** Esvazia o Índice do Canal — usado em re-ingestão a partir do zero. */
  clear(channelId: string): Promise<void>;
}

/** Atributos indexados para busca full-text no Meilisearch. */
export const SEARCHABLE_ATTRIBUTES: readonly string[] = ["title", "description", "text", "author"];

/** Atributos aceitos em `filter=` no Meilisearch. */
export const FILTERABLE_ATTRIBUTES: readonly string[] = ["type", "publishedAt"];

/** Atributos aceitos em `sort=` no Meilisearch. */
export const SORTABLE_ATTRIBUTES: readonly string[] = ["publishedAt"];

/** Stop words em português compartilhadas por todos os Índices de Canal. */
export const STOP_WORDS_PT: readonly string[] = [
  "a", "as", "o", "os", "e", "em", "de", "da", "do", "das", "dos",
  "um", "uma", "uns", "umas", "que", "para", "por", "com", "sem",
  "não", "na", "no", "nas", "nos", "ao", "aos", "se", "mas", "como",
  "mais", "menos", "muito", "muita", "este", "esta", "isso", "isto",
  "são", "ser", "foi", "era", "ou", "já", "também", "ainda", "quando",
  "onde", "depois", "antes", "então", "agora",
];

export function videoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function videoThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function segmentUrl(videoId: string, start: number): string {
  return `${videoUrl(videoId)}&t=${Math.floor(start)}s`;
}

export function commentUrl(videoId: string, commentId: string): string {
  return `${videoUrl(videoId)}&lc=${encodeURIComponent(commentId)}`;
}

export function toVideoDocument(video: VideoRecord): VideoSearchDocument {
  return {
    id: video.id,
    channelId: video.channelId,
    type: "video",
    title: video.title,
    description: video.description,
    views: video.views,
    likes: video.likes,
    durationSeconds: video.durationSeconds,
    url: videoUrl(video.id),
    thumbnail: videoThumbnail(video.id),
    publishedAt: video.publishedAt,
  };
}

export function toCommentDocument(comment: CommentRecord, videoContext: VideoContext): CommentSearchDocument {
  return {
    id: comment.id,
    channelId: comment.channelId,
    type: "comment",
    videoId: comment.videoId,
    videoTitle: videoContext.title,
    videoUrl: videoUrl(comment.videoId),
    videoThumbnail: videoThumbnail(comment.videoId),
    videoViews: videoContext.views,
    videoLikes: videoContext.likes,
    url: commentUrl(comment.videoId, comment.id),
    author: comment.author,
    text: comment.text,
    likes: comment.likes,
    publishedAt: comment.publishedAt,
  };
}

export function toSegmentDocument(segment: TranscriptSegmentRecord, videoContext: VideoContext): SegmentSearchDocument {
  return {
    id: segment.id,
    channelId: segment.channelId,
    type: "segment",
    videoId: segment.videoId,
    videoTitle: videoContext.title,
    videoUrl: videoUrl(segment.videoId),
    videoThumbnail: videoThumbnail(segment.videoId),
    videoViews: videoContext.views,
    videoLikes: videoContext.likes,
    text: segment.text,
    start: segment.start,
    end: segment.end,
    url: segmentUrl(segment.videoId, segment.start),
    publishedAt: videoContext.publishedAt,
  };
}
