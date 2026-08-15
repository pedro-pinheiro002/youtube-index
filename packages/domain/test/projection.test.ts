import { describe, expect, it } from "vitest";
import { toVideoDocument, videoThumbnail, videoUrl } from "../src/projection.js";

const CHANNEL_ID = "UCY8iijN1AkyDCh1Z9akcqUA";

describe("toVideoDocument", () => {
  it("monta o Documento de Vídeo com URL e thumbnail derivadas do id", () => {
    const doc = toVideoDocument({
      id: "v1",
      channelId: CHANNEL_ID,
      title: "Primeiro vídeo",
      description: "Uma descrição",
      publishedAt: "2023-01-01T00:00:00Z",
      views: 1234,
      likes: 56,
      durationSeconds: 542,
    });

    expect(doc).toEqual({
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
    });
  });

  it("deriva a URL do Vídeo para deep-link", () => {
    expect(videoUrl("abc123")).toBe("https://www.youtube.com/watch?v=abc123");
  });

  it("deriva a thumbnail do Vídeo", () => {
    expect(videoThumbnail("abc123")).toBe("https://i.ytimg.com/vi/abc123/hqdefault.jpg");
  });
});
