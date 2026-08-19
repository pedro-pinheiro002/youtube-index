import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/schema.js";
import { SqliteLedger } from "../src/ledger.js";
import { SqliteIngestionQueue } from "../src/ingestion-queue.js";
import { YouTubeDataApiClient } from "../src/youtube.js";
import { YoutubeTranscriptFetcher } from "../src/transcripts.js";
import { MeilisearchProjection } from "../src/meilisearch.js";
import { createServices, MissingConfigError } from "../src/services.js";

const CONFIG = {
  youtubeApiKey: "test-key",
  meilisearchUrl: "http://localhost:7700",
  meilisearchMasterKey: "master",
};

// Fake `typeof fetch` que atende o fluxo getOrCreateRestrictedSearchKey:
// GET /keys → lista vazia; POST /keys → cria a chave restrita.
function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = init?.method ?? "GET";
  if (method === "GET" && url.endsWith("/keys")) {
    return Promise.resolve(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }
  if (method === "POST" && url.endsWith("/keys")) {
    return Promise.resolve(
      new Response(
        JSON.stringify({
          key: "fake-restricted-key",
          description: "test",
          actions: ["search"],
          indexes: ["transcripts"],
          createdAt: "2025-01-01T00:00:00Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  }
  return Promise.resolve(
    new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
  );
}

function makeServices() {
  const db = createDatabase(":memory:");
  return createServices({ db, config: CONFIG, fetchImpl: fakeFetch as typeof fetch });
}

describe("createServices", () => {
  it("retorna os 7 serviços com os tipos corretos", async () => {
    const services = await makeServices();

    expect(services.ledger).toBeInstanceOf(SqliteLedger);
    expect(services.queue).toBeInstanceOf(SqliteIngestionQueue);
    expect(services.youtube).toBeInstanceOf(YouTubeDataApiClient);
    expect(services.transcripts).toBeInstanceOf(YoutubeTranscriptFetcher);
    expect(services.projection).toBeInstanceOf(MeilisearchProjection);
    expect(services.projection).toBeTruthy();
    expect(typeof services.projection.addDocuments).toBe("function");
    expect(services.ingestion).toBeTruthy();
    expect(typeof services.ingestion.runJob).toBe("function");
    expect(services.search).toBeTruthy();
    expect(typeof services.search.search).toBe("function");
  });

  it("compartilha a mesma instância MeilisearchProjection entre projection e search", async () => {
    const services = await makeServices();

    expect(services.projection).toBe(services.search);
  });

  it("lança MissingConfigError quando youtubeApiKey está ausente", async () => {
    const db = createDatabase(":memory:");
    await expect(
      createServices({
        db,
        config: {
          youtubeApiKey: undefined as unknown as string,
          meilisearchUrl: "http://localhost:7700",
          meilisearchMasterKey: "master",
        },
        fetchImpl: fakeFetch as typeof fetch,
      }),
    ).rejects.toMatchObject({ name: "MissingConfigError" });
  });

  it("lança MissingConfigError quando youtubeApiKey é string vazia", async () => {
    const db = createDatabase(":memory:");
    await expect(
      createServices({
        db,
        config: {
          youtubeApiKey: "",
          meilisearchUrl: "http://localhost:7700",
          meilisearchMasterKey: "master",
        },
        fetchImpl: fakeFetch as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(MissingConfigError);
  });
});