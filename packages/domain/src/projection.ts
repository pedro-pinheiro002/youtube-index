import type { VideoRecord } from "./ledger.js";

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

export interface Projection {
  addDocuments(channelId: string, documents: SearchDocument[]): Promise<void>;
}

export function videoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function videoThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
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
