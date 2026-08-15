import { afterEach, describe, expect, it, vi } from "vitest";
import { createChannel, getChannel } from "../src/api";
import { makeChannel } from "./helpers";

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
});