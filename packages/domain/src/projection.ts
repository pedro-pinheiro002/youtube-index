import type { CommentRecord, TranscriptSegmentRecord, VideoRecord } from "./ledger.js";

export type SearchDocumentType = "video" | "comment" | "segment";

export interface SearchDocument {
  id: string;
  channelId: string;
  type: SearchDocumentType;
}

export interface VideoSearchDocument extends SearchDocument {
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

export interface CommentSearchDocument extends SearchDocument {
  type: "comment";
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  videoThumbnail: string;
  author: string;
  text: string;
  likes: number;
  publishedAt: string;
}

export interface SegmentSearchDocument extends SearchDocument {
  type: "segment";
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  videoThumbnail: string;
  text: string;
  start: number;
  end: number;
  url: string;
  publishedAt: string;
}

export interface Projection {
  addDocuments(channelId: string, documents: SearchDocument[]): Promise<void>;
}

export function videoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function videoThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function segmentUrl(videoId: string, start: number): string {
  return `${videoUrl(videoId)}&t=${Math.floor(start)}s`;
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

export function toCommentDocument(comment: CommentRecord): CommentSearchDocument {
  return {
    id: comment.id,
    channelId: comment.channelId,
    type: "comment",
    videoId: comment.videoId,
    videoTitle: comment.videoTitle,
    videoUrl: videoUrl(comment.videoId),
    videoThumbnail: videoThumbnail(comment.videoId),
    author: comment.author,
    text: comment.text,
    likes: comment.likes,
    publishedAt: comment.publishedAt,
  };
}

export function toSegmentDocument(segment: TranscriptSegmentRecord): SegmentSearchDocument {
  return {
    id: segment.id,
    channelId: segment.channelId,
    type: "segment",
    videoId: segment.videoId,
    videoTitle: segment.videoTitle,
    videoUrl: videoUrl(segment.videoId),
    videoThumbnail: videoThumbnail(segment.videoId),
    text: segment.text,
    start: segment.start,
    end: segment.end,
    url: segmentUrl(segment.videoId, segment.start),
    publishedAt: segment.videoPublishedAt,
  };
}
