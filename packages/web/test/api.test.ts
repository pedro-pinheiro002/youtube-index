import { afterEach, describe, expect, it, vi } from "vitest";
import { createChannel, getChannel, searchChannel } from "../src/api";
import { makeChannel, makeSearchResponse } from "./helpers";

const CHANNEL_ID = "UCY8iijN1AkyDCh1Z9akcqUA";

describe("api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("createChannel faz POST /channels com o handle e devolve o Canal", async () => {
    const channel = makeChannel("queued");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => channel,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createChannel("@funkyblackcat");

    expect(fetchMock).toHaveBeenCalledWith("/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle: "@funkyblackcat" }),
    });
    expect(result).toEqual(channel);
  });

  it("createChannel lança a mensagem de erro da API quando a requisição falha", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: "Canal não encontrado para handle '@nao-existe'" }),
      }),
    );

    await expect(createChannel("@nao-existe")).rejects.toThrow(
      "Canal não encontrado para handle '@nao-existe'",
    );
  });

  it("getChannel faz GET /channels/:id e devolve o Canal", async () => {
    const channel = makeChannel("ingesting");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => channel,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getChannel("UCY8iijN1AkyDCh1Z9akcqUA");

    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/channels/UCY8iijN1AkyDCh1Z9akcqUA");
    expect(result).toEqual(channel);
  });

  it("searchChannel faz GET /search com q e channelId", async () => {
    const response = makeSearchResponse();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => response,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchChannel({ q: "vídeo", channelId: CHANNEL_ID });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/search?q=v%C3%ADdeo&channelId=${CHANNEL_ID}`);
    expect(result).toEqual(response);
  });

  it("searchChannel inclui tipo e sort quando informados", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeSearchResponse(),
    });
    vi.stubGlobal("fetch", fetchMock);

    await searchChannel({ q: "gato", channelId: CHANNEL_ID, tipo: "comment", sort: "publishedAt" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/search?q=gato&channelId=${CHANNEL_ID}&tipo=comment&sort=publishedAt`,
    );
  });

  it("searchChannel propaga o erro da API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: "Canal não encontrado" }),
      }),
    );

    await expect(searchChannel({ q: "gato", channelId: "desconhecido" })).rejects.toThrow(
      "Canal não encontrado",
    );
  });
});