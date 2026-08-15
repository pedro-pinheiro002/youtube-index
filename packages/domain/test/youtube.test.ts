import { describe, expect, it } from "vitest";
import { ChannelNotFoundError, YouTubeApiError, YouTubeDataApiClient, parseIsoDuration } from "../src/youtube.js";

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("YouTubeDataApiClient", () => {
  describe("resolveHandle", () => {
    it("resolve o handle para channelId e título", async () => {
      const fetchImpl = async (url: string | URL | Request) => {
        const u = new URL(String(url));
        expect(u.pathname).toBe("/youtube/v3/channels");
        expect(u.searchParams.get("part")).toBe("snippet");
        expect(u.searchParams.get("forHandle")).toBe("funkyblackcat");
        expect(u.searchParams.get("key")).toBe("test-key");
        return okResponse({
          items: [{ id: "UCY8iijN1AkyDCh1Z9akcqUA", snippet: { title: "Funky Black Cat" } }],
        });
      };
      const client = new YouTubeDataApiClient("test-key", fetchImpl);

      const result = await client.resolveHandle("@funkyblackcat");

      expect(result).toEqual({ channelId: "UCY8iijN1AkyDCh1Z9akcqUA", title: "Funky Black Cat" });
    });

    it("normaliza o handle sem @ para a busca por handle", async () => {
      const fetchImpl = async (url: string | URL | Request) => {
        expect(new URL(String(url)).searchParams.get("forHandle")).toBe("funkyblackcat");
        return okResponse({ items: [{ id: "UCY8iijN1AkyDCh1Z9akcqUA", snippet: { title: "Funky Black Cat" } }] });
      };
      const client = new YouTubeDataApiClient("test-key", fetchImpl);

      const result = await client.resolveHandle("funkyblackcat");

      expect(result.channelId).toBe("UCY8iijN1AkyDCh1Z9akcqUA");
    });

    it("lança ChannelNotFoundError quando não há itens", async () => {
      const fetchImpl = async () => okResponse({ items: [] });
      const client = new YouTubeDataApiClient("test-key", fetchImpl);

      await expect(client.resolveHandle("@nao-existe")).rejects.toBeInstanceOf(ChannelNotFoundError);
    });

    it("lança ChannelNotFoundError em resposta 404", async () => {
      const fetchImpl = async () => new Response("{}", { status: 404 });
      const client = new YouTubeDataApiClient("test-key", fetchImpl);

      await expect(client.resolveHandle("@nao-existe")).rejects.toBeInstanceOf(ChannelNotFoundError);
    });

    it("lança YouTubeApiError em falha de API (ex.: 403 de cota)", async () => {
      const fetchImpl = async () => new Response("{}", { status: 403 });
      const client = new YouTubeDataApiClient("test-key", fetchImpl);

      await expect(client.resolveHandle("@funkyblackcat")).rejects.toBeInstanceOf(YouTubeApiError);
    });
  });

  describe("getUploadsPlaylistId", () => {
    it("resolve a playlist de uploads a partir do contentDetails do Canal", async () => {
      const fetchImpl = async (url: string | URL | Request) => {
        const u = new URL(String(url));
        expect(u.pathname).toBe("/youtube/v3/channels");
        expect(u.searchParams.get("part")).toBe("contentDetails");
        expect(u.searchParams.get("id")).toBe("UCY8iijN1AkyDCh1Z9akcqUA");
        expect(u.searchParams.get("key")).toBe("test-key");
        return okResponse({
          items: [{ id: "UCY8iijN1AkyDCh1Z9akcqUA", contentDetails: { relatedPlaylists: { uploads: "UULF-xyz" } } }],
        });
      };
      const client = new YouTubeDataApiClient("test-key", fetchImpl);

      const playlistId = await client.getUploadsPlaylistId("UCY8iijN1AkyDCh1Z9akcqUA");

      expect(playlistId).toBe("UULF-xyz");
    });

    it("lança YouTubeApiError quando o Canal não tem playlist de uploads", async () => {
      const fetchImpl = async () => okResponse({ items: [{ id: "UCY8iijN1AkyDCh1Z9akcqUA" }] });
      const client = new YouTubeDataApiClient("test-key", fetchImpl);

      await expect(client.getUploadsPlaylistId("UCY8iijN1AkyDCh1Z9akcqUA")).rejects.toBeInstanceOf(YouTubeApiError);
    });
  });

  describe("listUploads", () => {
    it("lista os Vídeos da playlist de uploads, paginado", async () => {
      const fetchImpl = async (url: string | URL | Request) => {
        const u = new URL(String(url));
        expect(u.pathname).toBe("/youtube/v3/playlistItems");
        expect(u.searchParams.get("part")).toBe("snippet");
        expect(u.searchParams.get("playlistId")).toBe("UULF-xyz");
        expect(u.searchParams.get("maxResults")).toBe("50");
        expect(u.searchParams.get("pageToken")).toBeNull();
        return okResponse({
          nextPageToken: "CAUQAA",
          items: [
            {
              snippet: {
                publishedAt: "2023-01-01T00:00:00Z",
                title: "Primeiro vídeo",
                description: "Uma descrição",
                resourceId: { videoId: "v1" },
              },
            },
          ],
        });
      };
      const client = new YouTubeDataApiClient("test-key", fetchImpl);

      const page = await client.listUploads("UULF-xyz");

      expect(page).toEqual({
        videos: [
          {
            id: "v1",
            title: "Primeiro vídeo",
            description: "Uma descrição",
            publishedAt: "2023-01-01T00:00:00Z",
          },
        ],
        nextPageToken: "CAUQAA",
      });
    });

    it("envia o pageToken quando solicitado", async () => {
      const fetchImpl = async (url: string | URL | Request) => {
        expect(new URL(String(url)).searchParams.get("pageToken")).toBe("CAUQAA");
        return okResponse({ items: [] });
      };
      const client = new YouTubeDataApiClient("test-key", fetchImpl);

      const page = await client.listUploads("UULF-xyz", "CAUQAA");

      expect(page).toEqual({ videos: [], nextPageToken: null });
    });

    it("ignora itens sem videoId (Vídeos privados/removidos)", async () => {
      const fetchImpl = async () =>
        okResponse({
          items: [
            { snippet: { title: "disponível", resourceId: { videoId: "v1" } } },
            { snippet: { title: "removido" } },
          ],
        });
      const client = new YouTubeDataApiClient("test-key", fetchImpl);

      const page = await client.listUploads("UULF-xyz");

      expect(page.videos.map((v) => v.id)).toEqual(["v1"]);
    });
  });

  describe("getVideoStats", () => {
    it("captura views, likes e duração via videos.list", async () => {
      const fetchImpl = async (url: string | URL | Request) => {
        const u = new URL(String(url));
        expect(u.pathname).toBe("/youtube/v3/videos");
        expect(u.searchParams.get("part")).toBe("contentDetails,statistics");
        expect(u.searchParams.get("id")).toBe("v1");
        return okResponse({
          items: [
            {
              contentDetails: { duration: "PT1H2M3S" },
              statistics: { viewCount: "1234", likeCount: "56" },
            },
          ],
        });
      };
      const client = new YouTubeDataApiClient("test-key", fetchImpl);

      const stats = await client.getVideoStats("v1");

      expect(stats).toEqual({ views: 1234, likes: 56, durationSeconds: 3723 });
    });

    it("devolve null quando o Vídeo não é encontrado (removido/indisponível)", async () => {
      const fetchImpl = async () => okResponse({ items: [] });
      const client = new YouTubeDataApiClient("test-key", fetchImpl);

      const stats = await client.getVideoStats("v1");

      expect(stats).toBeNull();
    });
  });

  describe("parseIsoDuration", () => {
    it.each([
      ["PT1H2M3S", 3723],
      ["PT2M", 120],
      ["PT45S", 45],
      ["PT1H", 3600],
      ["PT0S", 0],
    ])("converte %s em %i segundos", (duration, expected) => {
      expect(parseIsoDuration(duration)).toBe(expected);
    });
  });
});