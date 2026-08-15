export interface ChannelResolution {
  channelId: string;
  title: string;
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
}

interface ChannelsListResponse {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
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
}