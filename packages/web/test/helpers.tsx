import type { ChannelWithPhases } from "../src/types";
import type { ChannelApi } from "../src/useChannel";

export function makeChannel(status: ChannelWithPhases["status"]): ChannelWithPhases {
  return {
    id: "UCY8iijN1AkyDCh1Z9akcqUA",
    handle: "@funkyblackcat",
    title: "Funky Black Cat",
    status,
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