import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/schema.js";
import { SqliteLedger } from "../src/ledger.js";
import {
  rebuildAllProjections,
  rebuildCommentsProjection,
  rebuildTranscriptsProjection,
  rebuildVideosProjection,
} from "../src/rebuild.js";
import type { Documento } from "../src/documento.js";

const CHANNEL_ID = "UCY8iijN1AkyDCh1Z9akcqUA";

function makeLedger() {
  return new SqliteLedger(createDatabase(":memory:"));
}

function makeRecordingProjection() {
  const calls: Array<{ channelId: string; documents: Documento[] }> = [];
  return {
    addDocuments: async (channelId: string, documents: Documento[]) => {
      calls.push({ channelId, documents });
    },
    remove: async () => {},
    clear: async () => {},
    calls,
  };
}

function makeChannelWithVideo(ledger: SqliteLedger) {
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

describe("rebuildCommentsProjection", () => {
  it("reconstrói a Projeção de Comentários a partir do SQLite sem chamar o YouTube", async () => {
    const ledger = makeLedger();
    makeChannelWithVideo(ledger);
    ledger.upsertComment({
      id: "c1",
      videoId: "v1",
      channelId: CHANNEL_ID,
      author: "Gato Funky",
      text: "Primeiro comentário",
      likes: 42,
      publishedAt: "2023-01-02T00:00:00Z",
    });
    const projection = makeRecordingProjection();

    const count = await rebuildCommentsProjection(CHANNEL_ID, { ledger, projection });

    expect(count).toBe(1);
    expect(projection.calls).toEqual([
      {
        channelId: CHANNEL_ID,
        documents: [
          expect.objectContaining({
            id: "c1",
            channelId: CHANNEL_ID,
            type: "comment",
            videoId: "v1",
            videoTitle: "Primeiro vídeo",
            videoUrl: "https://www.youtube.com/watch?v=v1",
            videoThumbnail: "https://i.ytimg.com/vi/v1/hqdefault.jpg",
            author: "Gato Funky",
            text: "Primeiro comentário",
            likes: 42,
            publishedAt: "2023-01-02T00:00:00Z",
          }),
        ],
      },
    ]);
  });

  it("devolve 0 sem chamar a Projeção quando o Canal não tem Comentários", async () => {
    const ledger = makeLedger();
    makeChannelWithVideo(ledger);
    const projection = makeRecordingProjection();

    const count = await rebuildCommentsProjection(CHANNEL_ID, { ledger, projection });

    expect(count).toBe(0);
    expect(projection.calls).toHaveLength(0);
  });
});

describe("rebuildTranscriptsProjection", () => {
  it("reconstrói a Projeção de Segmentos a partir do SQLite sem chamar o YouTube", async () => {
    const ledger = makeLedger();
    makeChannelWithVideo(ledger);
    ledger.upsertTranscriptSegment({
      id: "v1:142",
      videoId: "v1",
      channelId: CHANNEL_ID,
      start: 142,
      end: 150,
      text: "trecho da transcrição",
    });
    const projection = makeRecordingProjection();

    const count = await rebuildTranscriptsProjection(CHANNEL_ID, { ledger, projection });

    expect(count).toBe(1);
    expect(projection.calls).toEqual([
      {
        channelId: CHANNEL_ID,
        documents: [
          expect.objectContaining({
            id: "v1:142",
            channelId: CHANNEL_ID,
            type: "segment",
            videoId: "v1",
            videoTitle: "Primeiro vídeo",
            videoUrl: "https://www.youtube.com/watch?v=v1",
            videoThumbnail: "https://i.ytimg.com/vi/v1/hqdefault.jpg",
            text: "trecho da transcrição",
            start: 142,
            end: 150,
            url: "https://www.youtube.com/watch?v=v1&t=142s",
            publishedAt: "2023-01-01T00:00:00Z",
          }),
        ],
      },
    ]);
  });

  it("devolve 0 sem chamar a Projeção quando o Canal não tem Segmentos", async () => {
    const ledger = makeLedger();
    makeChannelWithVideo(ledger);
    const projection = makeRecordingProjection();

    const count = await rebuildTranscriptsProjection(CHANNEL_ID, { ledger, projection });

    expect(count).toBe(0);
    expect(projection.calls).toHaveLength(0);
  });
});

describe("rebuildAllProjections", () => {
  it("itera todas as Fases, soma as contagens e chama cada rebuild uma vez", async () => {
    const ledger = makeLedger();
    makeChannelWithVideo(ledger);
    ledger.upsertComment({
      id: "c1",
      videoId: "v1",
      channelId: CHANNEL_ID,
      author: "Gato Funky",
      text: "Primeiro comentário",
      likes: 42,
      publishedAt: "2023-01-02T00:00:00Z",
    });
    ledger.upsertTranscriptSegment({
      id: "v1:142",
      videoId: "v1",
      channelId: CHANNEL_ID,
      start: 142,
      end: 150,
      text: "trecho da transcrição",
    });
    const projection = makeRecordingProjection();

    const count = await rebuildAllProjections(CHANNEL_ID, { ledger, projection });

    // 1 vídeo + 1 comentário + 1 segmento
    expect(count).toBe(3);
    // cada Fase projeta exatamente uma vez
    expect(projection.calls).toHaveLength(3);
    const types = projection.calls.flatMap((c) => c.documents.map((d) => d.type));
    expect(types).toEqual(["video", "comment", "segment"]);
  });

  it("devolve 0 sem chamar a Projeção quando o Canal não tem registros", async () => {
    const ledger = makeLedger();
    ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
    const projection = makeRecordingProjection();

    const count = await rebuildAllProjections(CHANNEL_ID, { ledger, projection });

    expect(count).toBe(0);
    expect(projection.calls).toHaveLength(0);
  });

  it("com um registry fake de uma Fase, chama apenas o rebuild dessa Fase", async () => {
    const ledger = makeLedger();
    makeChannelWithVideo(ledger);
    const projection = makeRecordingProjection();

    const fakePhases = [
      { key: "videos" as const, label: "Vídeos", doc: "video" as const, describe: () => "" },
    ];

    const count = await rebuildAllProjections(CHANNEL_ID, { ledger, projection }, fakePhases);

    expect(count).toBe(1);
    // apenas a Fase de Vídeos é reconstruída
    expect(projection.calls).toHaveLength(1);
    expect(projection.calls[0]?.documents.map((d) => d.type)).toEqual(["video"]);
  });
});
