export interface ChannelResolution {
  channelId: string;
  title: string;
}

export interface YouTubeVideo {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
}

export interface UploadsPage {
  videos: YouTubeVideo[];
  nextPageToken: string | null;
}

export interface YouTubeVideoStats {
  views: number;
  likes: number;
  durationSeconds: number;
}

export class ChannelNotFoundError extends Error {
  constructor(handle: string) {
    super(`Canal não encontrado para handle '${handle}'`);
    this.name = "ChannelNotFoundError";
  }
}

export class YouTubeApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "YouTubeApiError";
  }
}

export interface YouTubeClient {
  resolveHandle(handle: string): Promise<ChannelResolution>;
  getUploadsPlaylistId(channelId: string): Promise<string>;
  listUploads(playlistId: string, pageToken?: string | null): Promise<UploadsPage>;
  getVideoStats(videoId: string): Promise<YouTubeVideoStats | null>;
}

interface ChannelsListResponse {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
    };
    contentDetails?: {
      relatedPlaylists?: {
        uploads?: string;
      };
    };
  }>;
}

interface PlaylistItemsListResponse {
  items?: Array<{
    snippet?: {
      publishedAt?: string;
      title?: string;
      description?: string;
      resourceId?: {
        videoId?: string;
      };
    };
  }>;
  nextPageToken?: string;
}

interface VideosListResponse {
  items?: Array<{
    contentDetails?: {
      duration?: string;
    };
    statistics?: {
      viewCount?: string;
      likeCount?: string;
    };
  }>;
}

export class YouTubeDataApiClient implements YouTubeClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(apiKey: string, fetchImpl: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  async resolveHandle(handle: string): Promise<ChannelResolution> {
    const normalized = handle.trim().replace(/^@/, "");
    const url = new URL("https://www.googleapis.com/youtube/v3/channels");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("forHandle", normalized);
    url.searchParams.set("key", this.apiKey);

    const res = await this.fetchImpl(url);
    if (res.status === 404) {
      throw new ChannelNotFoundError(handle);
    }
    if (!res.ok) {
      throw new YouTubeApiError(`YouTube API respondeu ${res.status} para handle '${handle}'`, res.status);
    }
    const data = (await res.json()) as ChannelsListResponse;
    const item = data.items?.[0];
    if (!item?.id) {
      throw new ChannelNotFoundError(handle);
    }
    return { channelId: item.id, title: item.snippet?.title ?? "" };
  }

  async getUploadsPlaylistId(channelId: string): Promise<string> {
    const url = new URL("https://www.googleapis.com/youtube/v3/channels");
    url.searchParams.set("part", "contentDetails");
    url.searchParams.set("id", channelId);
    url.searchParams.set("key", this.apiKey);

    const res = await this.fetchImpl(url);
    if (!res.ok) {
      throw new YouTubeApiError(`YouTube API respondeu ${res.status} para channelId '${channelId}'`, res.status);
    }
    const data = (await res.json()) as ChannelsListResponse;
    const uploads = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) {
      throw new YouTubeApiError(`Canal '${channelId}' não possui playlist de uploads`, res.status);
    }
    return uploads;
  }

  async listUploads(playlistId: string, pageToken?: string): Promise<UploadsPage> {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("maxResults", "50");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }
    url.searchParams.set("key", this.apiKey);

    const res = await this.fetchImpl(url);
    if (!res.ok) {
      throw new YouTubeApiError(`YouTube API respondeu ${res.status} ao listar uploads`, res.status);
    }
    const data = (await res.json()) as PlaylistItemsListResponse;
    const videos = (data.items ?? [])
      .filter((item) => item.snippet?.resourceId?.videoId)
      .map((item) => ({
        id: item.snippet!.resourceId!.videoId!,
        title: item.snippet!.title ?? "",
        description: item.snippet!.description ?? "",
        publishedAt: item.snippet!.publishedAt ?? "",
      }));
    return { videos, nextPageToken: data.nextPageToken ?? null };
  }

  async getVideoStats(videoId: string): Promise<YouTubeVideoStats | null> {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "contentDetails,statistics");
    url.searchParams.set("id", videoId);
    url.searchParams.set("key", this.apiKey);

    const res = await this.fetchImpl(url);
    if (!res.ok) {
      throw new YouTubeApiError(`YouTube API respondeu ${res.status} ao buscar estatísticas de '${videoId}'`, res.status);
    }
    const data = (await res.json()) as VideosListResponse;
    const item = data.items?.[0];
    if (!item) {
      return null;
    }
    return {
      views: Number(item.statistics?.viewCount ?? 0),
      likes: Number(item.statistics?.likeCount ?? 0),
      durationSeconds: parseIsoDuration(item.contentDetails?.duration ?? "PT0S"),
    };
  }
}

export function parseIsoDuration(duration: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(duration);
  if (!match) {
    return 0;
  }
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}