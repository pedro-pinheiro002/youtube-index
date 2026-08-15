import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
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