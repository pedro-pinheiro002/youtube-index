import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { ChannelNotFoundError, type YouTubeClient } from "@youtube-index/domain";
import { makeConfig, makeLedger, makeSearchClient, makeYouTubeClient } from "./helpers.js";

describe("GET /health", () => {
  it("responde com status ok", async () => {
    const app = buildApp(makeConfig(), { ledger: makeLedger(), youtube: makeYouTubeClient(), search: makeSearchClient() });

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("rota desconhecida responde 404 quando sem frontend estático", async () => {
    const app = buildApp(makeConfig(), { ledger: makeLedger(), youtube: makeYouTubeClient(), search: makeSearchClient() });

    const res = await app.inject({ method: "GET", url: "/nao-existe" });

    expect(res.statusCode).toBe(404);
  });
});

describe("POST /channels", () => {
  it("resolve o handle, cria o Canal no SQLite e enfileira um job", async () => {
    const ledger = makeLedger();
    const youtube = makeYouTubeClient({ channelId: "UCY8iijN1AkyDCh1Z9akcqUA", title: "Funky Black Cat" });
    const app = buildApp(makeConfig(), { ledger, youtube, search: makeSearchClient() });

    const res = await app.inject({
      method: "POST",
      url: "/channels",
      payload: { handle: "@funkyblackcat" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      id: "UCY8iijN1AkyDCh1Z9akcqUA",
      handle: "@funkyblackcat",
      title: "Funky Black Cat",
      status: "queued",
    });

    const channel = ledger.getChannel("UCY8iijN1AkyDCh1Z9akcqUA");
    expect(channel?.phases.videos.status).toBe("pending");
    expect(ledger.listJobs("UCY8iijN1AkyDCh1Z9akcqUA")).toHaveLength(1);
  });

  it("responde 201 criando o Canal mesmo quando o handle já foi resolvido antes", async () => {
    const ledger = makeLedger();
    const youtube = makeYouTubeClient();
    const app = buildApp(makeConfig(), { ledger, youtube, search: makeSearchClient() });

    const first = await app.inject({
      method: "POST",
      url: "/channels",
      payload: { handle: "@funkyblackcat" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/channels",
      payload: { handle: "@funkyblackcat" },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toMatchObject({ id: "UCY8iijN1AkyDCh1Z9akcqUA" });
    expect(ledger.listJobs("UCY8iijN1AkyDCh1Z9akcqUA")).toHaveLength(2);
  });

  it("responde 404 quando o handle não é resolvido", async () => {
    const youtube: YouTubeClient = {
      resolveHandle: async () => {
        throw new ChannelNotFoundError("@nao-existe");
      },
      getUploadsPlaylistId: async () => {
        throw new Error("não usado neste teste");
      },
      listUploads: async () => {
        throw new Error("não usado neste teste");
      },
      getVideoStats: async () => {
        throw new Error("não usado neste teste");
      },
      listComments: async () => {
        throw new Error("não usado neste teste");
      },
    };
    const app = buildApp(makeConfig(), { ledger: makeLedger(), youtube, search: makeSearchClient() });

    const res = await app.inject({
      method: "POST",
      url: "/channels",
      payload: { handle: "@nao-existe" },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("GET /channels/:id", () => {
  it("devolve o Canal com status e progresso por Fase", async () => {
    const ledger = makeLedger();
    const app = buildApp(makeConfig(), { ledger, youtube: makeYouTubeClient(), search: makeSearchClient() });
    ledger.createChannel({
      channelId: "UCY8iijN1AkyDCh1Z9akcqUA",
      handle: "@funkyblackcat",
      title: "Funky Black Cat",
    });

    const res = await app.inject({ method: "GET", url: "/channels/UCY8iijN1AkyDCh1Z9akcqUA" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: "UCY8iijN1AkyDCh1Z9akcqUA",
      status: "queued",
      phases: {
        videos: { phase: "videos", status: "pending", done: 0, total: null },
        comments: { phase: "comments", status: "pending", done: 0, total: null },
        transcripts: { phase: "transcripts", status: "pending", done: 0, total: null },
      },
    });
  });

  it("devolve 404 para um channelId desconhecido", async () => {
    const app = buildApp(makeConfig(), { ledger: makeLedger(), youtube: makeYouTubeClient(), search: makeSearchClient() });

    const res = await app.inject({ method: "GET", url: "/channels/desconhecido" });

    expect(res.statusCode).toBe(404);
  });
});