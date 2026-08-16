import type { ChannelWithPhases, SearchHit, SearchResponse } from "../src/types";
import type { ChannelApi } from "../src/useChannel";
import type { SearchApi } from "../src/useSearch";

type VideoSearchHit = Extract<SearchHit, { type: "video" }>;
type CommentSearchHit = Extract<SearchHit, { type: "comment" }>;
type SegmentSearchHit = Extract<SearchHit, { type: "segment" }>;

export function makeChannel(status: ChannelWithPhases["status"]): ChannelWithPhases {
  return {
    id: "UCY8iijN1AkyDCh1Z9akcqUA",
    handle: "@funkyblackcat",
    title: "Funky Black Cat",
    status,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    phases: {
      videos: { phase: "videos", status: "pending", done: 0, total: null },
      comments: { phase: "comments", status: "pending", done: 0, total: null },
      transcripts: { phase: "transcripts", status: "pending", done: 0, total: null },
    },
  };
}

export function makeChannelWithPhases(
  overrides: Partial<ChannelWithPhases> = {},
): ChannelWithPhases {
  return {
    ...makeChannel("ingesting"),
    ...overrides,
  };
}

export function makeApi(overrides: Partial<ChannelApi> = {}): ChannelApi {
  return {
    createChannel: async () => makeChannel("queued"),
    getChannel: async () => makeChannel("queued"),
    ...overrides,
  };
}

const CHANNEL_ID = "UCY8iijN1AkyDCh1Z9akcqUA";

export function makeVideoHit(overrides: Partial<VideoSearchHit> = {}): VideoSearchHit {
  return {
    id: "v1",
    channelId: CHANNEL_ID,
    type: "video",
    title: "Primeiro vídeo",
    description: "Descrição do primeiro vídeo",
    views: 1234,
    likes: 56,
    durationSeconds: 142,
    url: "https://www.youtube.com/watch?v=v1",
    thumbnail: "https://i.ytimg.com/vi/v1/hqdefault.jpg",
    publishedAt: "2026-01-01T00:00:00.000Z",
    _formatted: {
      title: "Primeiro <em>vídeo</em>",
      description: "Descrição do primeiro <em>vídeo</em>",
    },
    ...overrides,
  };
}

export function makeCommentHit(overrides: Partial<CommentSearchHit> = {}): CommentSearchHit {
  return {
    id: "c1",
    channelId: CHANNEL_ID,
    type: "comment",
    videoId: "v1",
    videoTitle: "Primeiro vídeo",
    videoUrl: "https://www.youtube.com/watch?v=v1",
    videoThumbnail: "https://i.ytimg.com/vi/v1/hqdefault.jpg",
    videoViews: 1234,
    videoLikes: 56,
    url: "https://www.youtube.com/watch?v=v1&lc=c1",
    author: "Gato Funky",
    text: "Comentário sobre o primeiro vídeo",
    likes: 12,
    publishedAt: "2026-01-02T00:00:00.000Z",
    _formatted: { text: "Comentário <em>sobre</em> o primeiro vídeo" },
    ...overrides,
  };
}

export function makeSegmentHit(overrides: Partial<SegmentSearchHit> = {}): SegmentSearchHit {
  return {
    id: "s1",
    channelId: CHANNEL_ID,
    type: "segment",
    videoId: "v1",
    videoTitle: "Primeiro vídeo",
    videoUrl: "https://www.youtube.com/watch?v=v1",
    videoThumbnail: "https://i.ytimg.com/vi/v1/hqdefault.jpg",
    videoViews: 1234,
    videoLikes: 56,
    text: "Trecho da transcrição",
    start: 142,
    end: 147,
    url: "https://www.youtube.com/watch?v=v1&t=142s",
    publishedAt: "2026-01-03T00:00:00.000Z",
    _formatted: { text: "Trecho da <em>transcrição</em>" },
    ...overrides,
  };
}

export function makeSearchResponse(overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    hits: [makeVideoHit()],
    total: 1,
    query: "vídeo",
    ...overrides,
  };
}

export function makeSearchApi(overrides: Partial<SearchApi> = {}): SearchApi {
  return {
    searchChannel: async (params) => makeSearchResponse({ query: params.q }),
    ...overrides,
  };
}