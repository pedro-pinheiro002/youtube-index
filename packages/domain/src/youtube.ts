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

export interface YouTubeComment {
  id: string;
  author: string;
  text: string;
  likes: number;
  publishedAt: string;
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

export class CommentsDisabledError extends Error {
  constructor(videoId: string) {
    super(`Comentários desativados para o Vídeo '${videoId}'`);
    this.name = "CommentsDisabledError";
  }
}

export interface YouTubeClient {
  resolveHandle(handle: string): Promise<ChannelResolution>;
  getUploadsPlaylistId(channelId: string): Promise<string>;
  listUploads(playlistId: string, pageToken?: string | null): Promise<UploadsPage>;
  getVideoStats(videoId: string): Promise<YouTubeVideoStats | null>;
  listComments(videoId: string): Promise<YouTubeComment[]>;
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

interface CommentThreadsListResponse {
  items?: Array<{
    snippet?: {
      topLevelComment?: {
        id?: string;
        snippet?: {
          authorDisplayName?: string;
          textOriginal?: string;
          likeCount?: string;
          publishedAt?: string;
        };
      };
    };
  }>;
}

interface ApiErrorBody {
  error?: {
    errors?: Array<{
      reason?: string;
    }>;
  };
}

export interface RetryConfig {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface ResolvedRetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleep: (ms: number) => Promise<void>;
}

const DEFAULT_RETRY: ResolvedRetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class YouTubeDataApiClient implements YouTubeClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retry: ResolvedRetryConfig;

  constructor(apiKey: string, fetchImpl: typeof fetch = fetch, retry: RetryConfig = {}) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.retry = { ...DEFAULT_RETRY, ...retry };
  }

  private async isRetriable(res: Response): Promise<boolean> {
    if (res.status === 429) {
      return true;
    }
    if (res.status !== 403) {
      return false;
    }
    const clone = res.clone();
    const data = (await clone.json().catch(() => null)) as ApiErrorBody | null;
    const disabled = data?.error?.errors?.some((error) => error.reason === "commentsDisabled");
    return !disabled;
  }

  private retryDelayMs(res: Response, attempt: number): number {
    const retryAfter = Number(res.headers.get("retry-after"));
    if (retryAfter) {
      return retryAfter * 1000;
    }
    const exponential = this.retry.baseDelayMs * 2 ** attempt;
    return Math.min(exponential, this.retry.maxDelayMs);
  }

  private async fetchWithRetry(url: URL): Promise<Response> {
    let attempt = 0;
    for (;;) {
      const res = await this.fetchImpl(url);
      if (attempt >= this.retry.maxRetries || !(await this.isRetriable(res))) {
        return res;
      }
      const delay = this.retryDelayMs(res, attempt);
      attempt += 1;
      await this.retry.sleep(delay);
    }
  }

  async resolveHandle(handle: string): Promise<ChannelResolution> {
    const normalized = handle.trim().replace(/^@/, "");
    const url = new URL("https://www.googleapis.com/youtube/v3/channels");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("forHandle", normalized);
    url.searchParams.set("key", this.apiKey);

    const res = await this.fetchWithRetry(url);
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

    const res = await this.fetchWithRetry(url);
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

    const res = await this.fetchWithRetry(url);
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

    const res = await this.fetchWithRetry(url);
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

  async listComments(videoId: string): Promise<YouTubeComment[]> {
    const url = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("videoId", videoId);
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("order", "relevance");
    url.searchParams.set("key", this.apiKey);

    const res = await this.fetchWithRetry(url);
    if (!res.ok) {
      if (res.status === 403) {
        const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
        if (data?.error?.errors?.some((error) => error.reason === "commentsDisabled")) {
          throw new CommentsDisabledError(videoId);
        }
      }
      throw new YouTubeApiError(
        `YouTube API respondeu ${res.status} ao buscar Comentários de '${videoId}'`,
        res.status,
      );
    }
    const data = (await res.json()) as CommentThreadsListResponse;
    return (data.items ?? [])
      .filter((item) => item.snippet?.topLevelComment?.id)
      .map((item) => {
        const comment = item.snippet!.topLevelComment!;
        const snippet = comment.snippet ?? {};
        return {
          id: comment.id!,
          author: snippet.authorDisplayName ?? "",
          text: snippet.textOriginal ?? "",
          likes: Number(snippet.likeCount ?? 0),
          publishedAt: snippet.publishedAt ?? "",
        };
      });
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