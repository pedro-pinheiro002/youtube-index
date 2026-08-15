import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/schema.js";
import { SqliteLedger } from "../src/ledger.js";
import { rebuildVideosProjection } from "../src/rebuild.js";
import type { VideoSearchDocument } from "../src/projection.js";

const CHANNEL_ID = "UCY8iijN1AkyDCh1Z9akcqUA";

function makeLedger() {
  return new SqliteLedger(createDatabase(":memory:"));
}

function makeRecordingProjection() {
  const calls: Array<{ channelId: string; documents: VideoSearchDocument[] }> = [];
  return {
    addDocuments: async (channelId: string, documents: VideoSearchDocument[]) => {
      calls.push({ channelId, documents });
    },
    calls,
  };
}

describe("rebuildVideosProjection", () => {
  it("reconstrói a Projeção de Vídeos a partir do SQLite sem chamar o YouTube", async () => {
    const ledger = makeLedger();
    ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
    ledger.upsertVideo({
      id: "v1",
      channelId: CHANNEL_ID,
      title: "Primeiro vídeo",
      description: "Uma descrição",
      publishedAt: "2023-01-01T00:00:00Z",
      views: 1234,
      likes: 56,
      durationSeconds: 542,
    });
    const projection = makeRecordingProjection();

    const count = await rebuildVideosProjection(CHANNEL_ID, { ledger, projection });

    expect(count).toBe(1);
    expect(projection.calls).toEqual([
      {
        channelId: CHANNEL_ID,
        documents: [
          expect.objectContaining({
            id: "v1",
            channelId: CHANNEL_ID,
            type: "video",
            title: "Primeiro vídeo",
            description: "Uma descrição",
            views: 1234,
            likes: 56,
            durationSeconds: 542,
            url: "https://www.youtube.com/watch?v=v1",
            thumbnail: "https://i.ytimg.com/vi/v1/hqdefault.jpg",
            publishedAt: "2023-01-01T00:00:00Z",
          }),
        ],
      },
    ]);
  });

  it("devolve 0 sem chamar a Projeção quando o Canal não tem Vídeos", async () => {
    const ledger = makeLedger();
    ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
    const projection = makeRecordingProjection();

    const count = await rebuildVideosProjection(CHANNEL_ID, { ledger, projection });

    expect(count).toBe(0);
    expect(projection.calls).toHaveLength(0);
  });
});
