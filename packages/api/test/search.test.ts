import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { SearchResponse } from "@youtube-index/domain";
import { makeConfig, makeLedger, makeQueue, makeSearchClient, makeYouTubeClient } from "./helpers.js";

const CHANNEL_ID = "UCY8iijN1AkyDCh1Z9akcqUA";

function makeResults(): SearchResponse {
  return {
    hits: [
      {
        id: "v1",
        channelId: CHANNEL_ID,
        type: "video",
        title: "Primeiro vídeo",
        description: "Descrição",
        views: 100,
        likes: 10,
        durationSeconds: 120,
        url: "https://www.youtube.com/watch?v=v1",
        thumbnail: "https://i.ytimg.com/vi/v1/hqdefault.jpg",
        publishedAt: "2023-01-01T00:00:00Z",
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
    const app = buildApp(makeConfig(), { ledger, queue: makeQueue(), youtube: makeYouTubeClient(), search });

    const res = await app.inject({ method: "GET", url: `/search?q=vídeo&channelId=${CHANNEL_ID}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(makeResults());
    expect(search.calls).toEqual([{ q: "vídeo", channelId: CHANNEL_ID }]);
  });

  it("passa tipo e sort para o cliente de Busca", async () => {
    const ledger = makeLedger();
    ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
    const search = makeSearchClient();
    const app = buildApp(makeConfig(), { ledger, queue: makeQueue(), youtube: makeYouTubeClient(), search });

    const res = await app.inject({
      method: "GET",
      url: `/search?q=x&channelId=${CHANNEL_ID}&tipo=video&sort=publishedAt`,
    });

    expect(res.statusCode).toBe(200);
    expect(search.calls).toEqual([{ q: "x", channelId: CHANNEL_ID, tipo: "video", sort: "publishedAt" }]);
  });

  it("retorna Comentários com destaque quando tipo=comment", async () => {
    const ledger = makeLedger();
    ledger.createChannel({ channelId: CHANNEL_ID, handle: "@funkyblackcat", title: "Funky Black Cat" });
    const commentResults: SearchResponse = {
      hits: [
        {
          id: "c1",
          channelId: CHANNEL_ID,
          type: "comment",
          videoId: "v1",
          videoTitle: "Primeiro vídeo",
          videoUrl: "https://www.youtube.com/watch?v=v1",
          videoThumbnail: "https://i.ytimg.com/vi/v1/hqdefault.jpg",
          videoViews: 100,
          videoLikes: 10,
          url: "https://www.youtube.com/watch?v=v1&lc=c1",
          author: "Gato Funky",
          text: "Primeiro comentário",
          likes: 5,
          publishedAt: "2023-01-01T00:00:00Z",
          _formatted: { text: "Primeiro <em>comentário</em>" },
        },
      ],
      total: 1,
      query: "comentário",
    };
    const search = makeSearchClient(commentResults);
    const app = buildApp(makeConfig(), { ledger, queue: makeQueue(), youtube: makeYouTubeClient(), search });

    const res = await app.inject({
      method: "GET",
      url: `/search?q=comentário&channelId=${CHANNEL_ID}&tipo=comment`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(commentResults);
    expect(search.calls).toEqual([{ q: "comentário", channelId: CHANNEL_ID, tipo: "comment" }]);
  });

  it("responde 400 quando q é obrigatório", async () => {
    const app = buildApp(makeConfig(), { ledger: makeLedger(), queue: makeQueue(), youtube: makeYouTubeClient(), search: makeSearchClient() });

    const res = await app.inject({ method: "GET", url: "/search" });

    expect(res.statusCode).toBe(400);
  });

  it("responde 400 quando channelId é obrigatório", async () => {
    const app = buildApp(makeConfig(), { ledger: makeLedger(), queue: makeQueue(), youtube: makeYouTubeClient(), search: makeSearchClient() });

    const res = await app.inject({ method: "GET", url: "/search?q=x" });

    expect(res.statusCode).toBe(400);
  });

  it("responde 404 para um channelId desconhecido", async () => {
    const app = buildApp(makeConfig(), { ledger: makeLedger(), queue: makeQueue(), youtube: makeYouTubeClient(), search: makeSearchClient() });

    const res = await app.inject({ method: "GET", url: "/search?q=x&channelId=desconhecido" });

    expect(res.statusCode).toBe(404);
  });

  it("responde 400 para tipo inválido", async () => {
    const app = buildApp(makeConfig(), { ledger: makeLedger(), queue: makeQueue(), youtube: makeYouTubeClient(), search: makeSearchClient() });

    const res = await app.inject({ method: "GET", url: `/search?q=x&channelId=${CHANNEL_ID}&tipo=reply` });

    expect(res.statusCode).toBe(400);
  });

  it("responde 400 para sort inválido", async () => {
    const app = buildApp(makeConfig(), { ledger: makeLedger(), queue: makeQueue(), youtube: makeYouTubeClient(), search: makeSearchClient() });

    const res = await app.inject({ method: "GET", url: `/search?q=x&channelId=${CHANNEL_ID}&sort=likes` });

    expect(res.statusCode).toBe(400);
  });
});
