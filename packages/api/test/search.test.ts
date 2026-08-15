import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { SearchResponse } from "@youtube-index/domain";
import { makeConfig, makeLedger, makeSearchClient, makeYouTubeClient } from "./helpers.js";

const CHANNEL_ID = "UCY8iijN1AkyDCh1Z9akcqUA";

function makeResults(): SearchResponse {
  return {
    hits: [
      {
        id: "v1",
        channelId: CHANNEL_ID,
        type: "video",
        title: "Primeiro vídeo",
        views: 100,
        likes: 10,
        durationSeconds: 120,
        url: "https://www.youtube.com/watch?v=v1",
        thumbnail: "https://i.ytimg.com/vi/v1/hqdefault.jpg",
        _formatted: { title: "Primeiro <em>vídeo</em>" },
      },
    ],
    total: 1,
    query: "vídeo",
  };
}

describe("GET /search", () => {
  it("passa a Busca para o Meilisearch e devolve Vídeos com highlight", async () => {
    const ledger = makeLedger();
    ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
    const search = makeSearchClient(makeResults());
    const app = buildApp(makeConfig(), { ledger, youtube: makeYouTubeClient(), search });

    const res = await app.inject({ method: "GET", url: `/search?q=vídeo&channelId=${CHANNEL_ID}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(makeResults());
    expect(search.calls).toEqual([{ q: "vídeo", channelId: CHANNEL_ID }]);
  });

  it("passa tipo e sort para o cliente de Busca", async () => {
    const ledger = makeLedger();
    ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
    const search = makeSearchClient();
    const app = buildApp(makeConfig(), { ledger, youtube: makeYouTubeClient(), search });

    const res = await app.inject({
      method: "GET",
      url: `/search?q=x&channelId=${CHANNEL_ID}&tipo=video&sort=publishedAt`,
    });

    expect(res.statusCode).toBe(200);
    expect(search.calls).toEqual([{ q: "x", channelId: CHANNEL_ID, tipo: "video", sort: "publishedAt" }]);
  });

  it("responde 400 quando q é obrigatório", async () => {
    const app = buildApp(makeConfig(), { ledger: makeLedger(), youtube: makeYouTubeClient(), search: makeSearchClient() });

    const res = await app.inject({ method: "GET", url: "/search" });

    expect(res.statusCode).toBe(400);
  });

  it("responde 400 quando channelId é obrigatório", async () => {
    const app = buildApp(makeConfig(), { ledger: makeLedger(), youtube: makeYouTubeClient(), search: makeSearchClient() });

    const res = await app.inject({ method: "GET", url: "/search?q=x" });

    expect(res.statusCode).toBe(400);
  });

  it("responde 404 para um channelId desconhecido", async () => {
    const app = buildApp(makeConfig(), { ledger: makeLedger(), youtube: makeYouTubeClient(), search: makeSearchClient() });

    const res = await app.inject({ method: "GET", url: "/search?q=x&channelId=desconhecido" });

    expect(res.statusCode).toBe(404);
  });

  it("responde 400 para tipo inválido", async () => {
    const app = buildApp(makeConfig(), { ledger: makeLedger(), youtube: makeYouTubeClient(), search: makeSearchClient() });

    const res = await app.inject({ method: "GET", url: `/search?q=x&channelId=${CHANNEL_ID}&tipo=reply` });

    expect(res.statusCode).toBe(400);
  });

  it("responde 400 para sort inválido", async () => {
    const app = buildApp(makeConfig(), { ledger: makeLedger(), youtube: makeYouTubeClient(), search: makeSearchClient() });

    const res = await app.inject({ method: "GET", url: `/search?q=x&channelId=${CHANNEL_ID}&sort=likes` });

    expect(res.statusCode).toBe(400);
  });
});
