import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

function makeConfig() {
  return {
    host: "127.0.0.1",
    port: 3000,
    meiliUrl: "http://localhost:7700",
    meiliMasterKey: "test-master-key",
    webDistDir: null,
    logger: false,
  };
}

describe("GET /health", () => {
  it("responde com status ok", async () => {
    const app = buildApp(makeConfig());

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("rota desconhecida responde 404 quando sem frontend estático", async () => {
    const app = buildApp(makeConfig());

    const res = await app.inject({ method: "GET", url: "/nao-existe" });

    expect(res.statusCode).toBe(404);
  });
});