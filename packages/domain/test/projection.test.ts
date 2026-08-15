import { describe, expect, it } from "vitest";
import {
  segmentUrl,
  toCommentDocument,
  toSegmentDocument,
  toVideoDocument,
  videoThumbnail,
  videoUrl,
} from "../src/projection.js";

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

describe("toCommentDocument", () => {
  it("monta o Documento de Comentário com contexto denormalizado do Vídeo", () => {
    const doc = toCommentDocument({
      id: "c1",
      videoId: "v1",
      channelId: CHANNEL_ID,
      videoTitle: "Primeiro vídeo",
      author: "Gato Funky",
      text: "Primeiro comentário",
      likes: 42,
      publishedAt: "2023-01-02T00:00:00Z",
    });

    expect(doc).toEqual({
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
    });
  });
});

describe("toSegmentDocument", () => {
  it("monta o Documento de Segmento com contexto do Vídeo e deep-link ao momento exato", () => {
    const doc = toSegmentDocument({
      id: "v1:142",
      videoId: "v1",
      channelId: CHANNEL_ID,
      videoTitle: "Primeiro vídeo",
      videoPublishedAt: "2023-01-01T00:00:00Z",
      start: 142,
      end: 150,
      text: "trecho da transcrição",
    });

    expect(doc).toEqual({
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
    });
  });

  it("deriva o deep-link do Segmento com &t=<start>s", () => {
    expect(segmentUrl("abc123", 142)).toBe("https://www.youtube.com/watch?v=abc123&t=142s");
  });
});
