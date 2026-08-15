import { describe, expect, it } from "vitest";
import { ChannelNotFoundError, YouTubeApiError, YouTubeDataApiClient } from "../src/youtube.js";

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
});