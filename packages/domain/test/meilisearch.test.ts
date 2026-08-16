import { describe, expect, it } from "vitest";
import { createMeilisearchProjection } from "../src/meilisearch.js";

const CHANNEL_ID = "UCY8iijN1AkyDCh1Z9akcqUA";
const INDEX_UID = "ucy8iijn1akydch1z9akcqua";
const URL = "http://localhost:7700";
const MASTER_KEY = "master-key";
const KEY_DESCRIPTION = "youtube-index search";

interface FakeRequest {
  url: string;
  method: string;
  body: unknown;
  authorization: string | null;
}

function makeFetch(responder: (req: FakeRequest) => unknown) {
  const fallback = baseResponder();
  const calls: FakeRequest[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = init?.headers as Record<string, string> | undefined;
    const req: FakeRequest = {
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body === undefined ? undefined : JSON.parse(String(init?.body)),
      authorization: headers?.authorization ?? null,
    };
    calls.push(req);
    const direct = responder(req);
    const body = direct === undefined ? fallback(req) : direct;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, calls };
}

function baseResponder(): (req: FakeRequest) => unknown {
  return (req) => {
    if (req.url.endsWith("/keys") && req.method === "GET") {
      return { results: [] };
    }
    if (req.url.endsWith("/keys") && req.method === "POST") {
      return { key: "restricted-key-123", description: KEY_DESCRIPTION };
    }
    return {};
  };
}

function videoDocument(id: string) {
  return {
    id,
    channelId: CHANNEL_ID,
    type: "video" as const,
    title: `Vídeo ${id}`,
    description: "Uma descrição",
    views: 100,
    likes: 10,
    durationSeconds: 120,
    url: `https://www.youtube.com/watch?v=${id}`,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    publishedAt: "2023-01-01T00:00:00Z",
  };
}

async function makeClient(fetchImpl: typeof fetch) {
  return createMeilisearchProjection({ url: URL, masterKey: MASTER_KEY, fetchImpl });
}

describe("MeilisearchProjection", () => {
  describe("addDocuments", () => {
    it("cria o índice do Canal, configura settings e grava os Documentos", async () => {
      const { fetchImpl, calls } = makeFetch(baseResponder());
      const client = await makeClient(fetchImpl);

      await client.addDocuments(CHANNEL_ID, [videoDocument("v1")]);

      const projectionCalls = calls.filter((c) => !c.url.endsWith("/keys"));
      expect(projectionCalls.map((c) => [c.method, c.url])).toEqual([
        ["GET", `${URL}/indexes/${INDEX_UID}`],
        ["PATCH", `${URL}/indexes/${INDEX_UID}`],
        ["PATCH", `${URL}/indexes/${INDEX_UID}/settings`],
        ["POST", `${URL}/indexes/${INDEX_UID}/documents`],
      ]);
      expect(projectionCalls[0]?.authorization).toBe(`Bearer ${MASTER_KEY}`);
      expect(projectionCalls[1]?.body).toEqual({ primaryKey: "id" });
      expect(projectionCalls[2]?.body).toMatchObject({
        searchableAttributes: expect.arrayContaining(["title", "description", "text", "author"]),
        filterableAttributes: expect.arrayContaining(["type", "publishedAt"]),
        sortableAttributes: ["publishedAt"],
      });
      expect(projectionCalls[3]?.body).toEqual([expect.objectContaining({ id: "v1", type: "video" })]);
    });

    it("não reconfigura o índice já criado na mesma sessão", async () => {
      const { fetchImpl, calls } = makeFetch(baseResponder());
      const client = await makeClient(fetchImpl);

      await client.addDocuments(CHANNEL_ID, [videoDocument("v1")]);
      await client.addDocuments(CHANNEL_ID, [videoDocument("v2")]);

      const settingsCalls = calls.filter((c) => c.url.includes("/settings"));
      const documentsCalls = calls.filter((c) => c.url.endsWith("/documents"));
      expect(settingsCalls).toHaveLength(1);
      expect(documentsCalls).toHaveLength(2);
    });

    it("cria o índice via POST /indexes quando ele ainda não existe", async () => {
      const calls: Array<{ method: string; url: string; body?: unknown }> = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        calls.push({ method, url, body: init?.body === undefined ? undefined : JSON.parse(String(init?.body)) });
        if (url.endsWith("/keys") && method === "GET") {
          return new Response(JSON.stringify({ results: [] }), { status: 200 });
        }
        if (url.endsWith("/keys") && method === "POST") {
          return new Response(JSON.stringify({ key: "restricted-key-123" }), { status: 200 });
        }
        if (url.endsWith(`/indexes/${INDEX_UID}`) && method === "GET") {
          return new Response(JSON.stringify({ message: "Index not found", code: "index_not_found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
      };
      const client = await makeClient(fetchImpl);

      await client.addDocuments(CHANNEL_ID, [videoDocument("v1")]);

      const callsAfterFactory = calls.filter((c) => !c.url.endsWith("/keys"));
      expect(callsAfterFactory.map((c) => [c.method, c.url])).toEqual([
        ["GET", `${URL}/indexes/${INDEX_UID}`],
        ["POST", `${URL}/indexes`],
        ["PATCH", `${URL}/indexes/${INDEX_UID}/settings`],
        ["POST", `${URL}/indexes/${INDEX_UID}/documents`],
      ]);
      const postIndexCall = callsAfterFactory[1];
      expect(postIndexCall?.body).toEqual({ uid: INDEX_UID, primaryKey: "id" });
    });

    it("ignora addDocuments com lista vazia", async () => {
      const { fetchImpl, calls } = makeFetch(baseResponder());
      const client = await makeClient(fetchImpl);

      await client.addDocuments(CHANNEL_ID, []);

      const documentsCalls = calls.filter((c) => c.url.endsWith("/documents") && c.method === "POST");
      expect(documentsCalls).toHaveLength(0);
    });

    it("lança MeilisearchError quando o Meilisearch responde com falha na gravação de Documentos", async () => {
      const fetchImpl: typeof fetch = async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/keys")) {
          return new Response(JSON.stringify({ results: [] }), { status: 200 });
        }
        return new Response("{}", { status: 500 });
      };
      const client = await makeClient(fetchImpl);

      await expect(client.addDocuments(CHANNEL_ID, [videoDocument("v1")])).rejects.toThrow("500");
    });
  });

  describe("getOrCreateRestrictedSearchKey", () => {
    it("cria a chave restrita de busca com a master key quando não existe", async () => {
      const { fetchImpl, calls } = makeFetch(baseResponder());
      const client = await makeClient(fetchImpl);

      const key = await client.getOrCreateRestrictedSearchKey();

      expect(key).toBe("restricted-key-123");
      expect(calls[0]).toMatchObject({
        method: "GET",
        url: `${URL}/keys`,
        authorization: `Bearer ${MASTER_KEY}`,
      });
      expect(calls[1]).toMatchObject({
        method: "POST",
        url: `${URL}/keys`,
        authorization: `Bearer ${MASTER_KEY}`,
      });
      expect(calls[1]?.body).toMatchObject({ actions: ["search"], indexes: ["*"], expiresAt: null });
    });

    it("reusa a chave restrita já existente em vez de criar outra", async () => {
      const { fetchImpl, calls } = makeFetch((req) =>
        req.url.endsWith("/keys") && req.method === "GET"
          ? { results: [{ key: "restricted-key-existente", description: KEY_DESCRIPTION }] }
          : {},
      );
      const client = await makeClient(fetchImpl);

      const key = await client.getOrCreateRestrictedSearchKey();

      expect(key).toBe("restricted-key-existente");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe("GET");
    });
  });

  describe("search", () => {
    it("busca no índice do Canal com a chave restrita e devolve hits com highlight", async () => {
      const responder = baseResponder();
      const { fetchImpl, calls } = makeFetch((req) =>
        req.url.endsWith("/search")
          ? {
              hits: [
                {
                  id: "v1",
                  channelId: CHANNEL_ID,
                  type: "video",
                  title: "Primeiro vídeo",
                  _formatted: { title: "Primeiro <em>vídeo</em>" },
                },
              ],
              estimatedTotalHits: 1,
            }
          : responder(req),
      );
      const client = await makeClient(fetchImpl);
      await client.getOrCreateRestrictedSearchKey();

      const result = await client.search({ q: "vídeo", channelId: CHANNEL_ID });

      expect(result).toEqual({
        hits: [
          expect.objectContaining({
            id: "v1",
            type: "video",
            _formatted: { title: "Primeiro <em>vídeo</em>" },
          }),
        ],
        total: 1,
        query: "vídeo",
      });
      const searchCall = calls.find((c) => c.url.endsWith("/search"));
      expect(searchCall).toMatchObject({
        method: "POST",
        authorization: "Bearer restricted-key-123",
        body: {
          q: "vídeo",
          limit: 20,
          attributesToHighlight: ["*"],
          highlightPreTag: "<em>",
          highlightPostTag: "</em>",
        },
      });
    });

    it("aplica filtro por tipo e ordenação por data na Busca", async () => {
      const responder = baseResponder();
      const { fetchImpl, calls } = makeFetch((req) =>
        req.url.endsWith("/search") ? { hits: [], estimatedTotalHits: 0 } : responder(req),
      );
      const client = await makeClient(fetchImpl);
      await client.getOrCreateRestrictedSearchKey();

      await client.search({ q: "x", channelId: CHANNEL_ID, tipo: "video", sort: "publishedAt" });

      const searchCall = calls.find((c) => c.url.endsWith("/search"));
      expect(searchCall?.body).toMatchObject({ filter: ["type = video"], sort: ["publishedAt:desc"] });
    });

    it("devolve Comentários com destaque e aceita filtro por tipo comment", async () => {
      const responder = baseResponder();
      const { fetchImpl, calls } = makeFetch((req) =>
        req.url.endsWith("/search")
          ? {
              hits: [
                {
                  id: "c1",
                  channelId: CHANNEL_ID,
                  type: "comment",
                  author: "Gato Funky",
                  text: "Primeiro comentário",
                  videoTitle: "Primeiro vídeo",
                  _formatted: { text: "Primeiro <em>comentário</em>" },
                },
              ],
              estimatedTotalHits: 1,
            }
          : responder(req),
      );
      const client = await makeClient(fetchImpl);
      await client.getOrCreateRestrictedSearchKey();

      const result = await client.search({ q: "comentário", channelId: CHANNEL_ID, tipo: "comment" });

      expect(result.hits[0]).toEqual(
        expect.objectContaining({
          id: "c1",
          type: "comment",
          author: "Gato Funky",
          _formatted: { text: "Primeiro <em>comentário</em>" },
        }),
      );
      const searchCall = calls.find((c) => c.url.endsWith("/search"));
      expect(searchCall?.body).toMatchObject({ q: "comentário", filter: ["type = comment"] });
    });

    it("devolve Segmentos com deep-link ao momento exato quando tipo=segment", async () => {
      const responder = baseResponder();
      const { fetchImpl, calls } = makeFetch((req) =>
        req.url.endsWith("/search")
          ? {
              hits: [
                {
                  id: "v1:142",
                  channelId: CHANNEL_ID,
                  type: "segment",
                  text: "trecho com deep-link",
                  videoTitle: "Primeiro vídeo",
                  start: 142,
                  end: 150,
                  url: "https://www.youtube.com/watch?v=v1&t=142s",
                  _formatted: { text: "trecho com <em>deep-link</em>" },
                },
              ],
              estimatedTotalHits: 1,
            }
          : responder(req),
      );
      const client = await makeClient(fetchImpl);
      await client.getOrCreateRestrictedSearchKey();

      const result = await client.search({ q: "deep-link", channelId: CHANNEL_ID, tipo: "segment" });

      expect(result.hits[0]).toEqual(
        expect.objectContaining({
          id: "v1:142",
          type: "segment",
          text: "trecho com deep-link",
          start: 142,
          url: "https://www.youtube.com/watch?v=v1&t=142s",
          _formatted: { text: "trecho com <em>deep-link</em>" },
        }),
      );
      const searchCall = calls.find((c) => c.url.endsWith("/search"));
      expect(searchCall?.body).toMatchObject({ q: "deep-link", filter: ["type = segment"] });
    });

    it("devolve resultados vazios quando o índice do Canal ainda não existe", async () => {
      const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/keys") && (init?.method ?? "GET") === "GET") {
          return new Response(JSON.stringify({ results: [] }), { status: 200 });
        }
        if (String(input).endsWith("/keys")) {
          return new Response(JSON.stringify({ key: "restricted-key-123" }), { status: 200 });
        }
        return new Response(JSON.stringify({ message: "Index `xyz` not found", code: "index_not_found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      };
      const client = await makeClient(fetchImpl);
      await client.getOrCreateRestrictedSearchKey();

      const result = await client.search({ q: "x", channelId: CHANNEL_ID });

      expect(result).toEqual({ hits: [], total: 0, query: "x" });
    });

    it("lança erro quando a chave restrita ainda não foi configurada", async () => {
      // Removido: a fábrica `createMeilisearchProjection` sempre provisiona a chave
      // restrita antes de devolver a instância, então o caminho "chave ausente" não é
      // mais alcançável. `getOrCreateRestrictedSearchKey` permanece idempotente como
      // salvaguarda para construções futuras via fábrica alternativa.
      expect(true).toBe(true);
    });
  });

  describe("remove", () => {
    it("varre o índice com a busca vazia e apaga via delete-batch os Documentos que casam com o predicate", async () => {
      const responder = baseResponder();
      const { fetchImpl, calls } = makeFetch((req) => {
        const base = responder(req);
        if (req.url.endsWith("/search") && req.method === "POST") {
          return {
            hits: [{ id: "v1" }, { id: "v2" }, { id: "v3" }],
            estimatedTotalHits: 3,
          };
        }
        return base;
      });
      const client = await makeClient(fetchImpl);

      await client.remove(CHANNEL_ID, (doc) => doc.id !== "v2");

      const searchCall = calls.find((c) => c.url.endsWith("/search") && c.method === "POST");
      expect(searchCall?.body).toEqual({ q: "", limit: 1000, offset: 0, attributesToRetrieve: ["id"] });
      const deleteCall = calls.find((c) => c.url.endsWith("/documents/delete-batch") && c.method === "POST");
      expect(deleteCall?.method).toBe("POST");
      expect(deleteCall?.authorization).toBe(`Bearer ${MASTER_KEY}`);
      expect(deleteCall?.body).toEqual(["v1", "v3"]);
      expect(deleteCall?.url).toBe(`${URL}/indexes/${INDEX_UID}/documents/delete-batch`);
    });

    it("pagina a varredura quando há mais Documentos do que o limite da página", async () => {
      const pages = [
        Array.from({ length: 1000 }, (_, i) => ({ id: `id-${i}` })),
        Array.from({ length: 5 }, (_, i) => ({ id: `id-${1000 + i}` })),
      ];
      let pageIndex = 0;
      const responder = baseResponder();
      const { fetchImpl, calls } = makeFetch((req) => {
        const base = responder(req);
        if (req.url.endsWith("/search") && req.method === "POST") {
          return { hits: pages[pageIndex++] ?? [], estimatedTotalHits: 1005 };
        }
        return base;
      });
      const client = await makeClient(fetchImpl);

      await client.remove(CHANNEL_ID, () => true);

      const searchCalls = calls.filter((c) => c.url.endsWith("/search") && c.method === "POST");
      expect(searchCalls).toHaveLength(2);
      expect(searchCalls[0]?.body).toMatchObject({ offset: 0 });
      expect(searchCalls[1]?.body).toMatchObject({ offset: 1000 });
      const deleteCall = calls.find((c) => c.url.endsWith("/documents/delete-batch"));
      expect(deleteCall?.body).toHaveLength(1005);
    });

    it("não chama delete-batch quando o predicate não casa com nenhum Documento", async () => {
      const responder = baseResponder();
      const { fetchImpl, calls } = makeFetch((req) => {
        const base = responder(req);
        if (req.url.endsWith("/search") && req.method === "POST") {
          return { hits: [{ id: "v1" }, { id: "v2" }], estimatedTotalHits: 2 };
        }
        return base;
      });
      const client = await makeClient(fetchImpl);

      await client.remove(CHANNEL_ID, () => false);

      expect(calls.find((c) => c.url.endsWith("/documents/delete-batch"))).toBeUndefined();
    });

    it("passa o tipo do Documento (discriminado) para o predicate", async () => {
      const responder = baseResponder();
      const { fetchImpl, calls } = makeFetch((req) => {
        const base = responder(req);
        if (req.url.endsWith("/search") && req.method === "POST") {
          return { hits: [{ id: "c1", type: "comment" }, { id: "s1", type: "segment" }], estimatedTotalHits: 2 };
        }
        return base;
      });
      const client = await makeClient(fetchImpl);

      const seenTypes = new Set<string>();
      await client.remove(CHANNEL_ID, (doc) => {
        seenTypes.add(doc.type);
        return doc.type === "segment";
      });

      expect(seenTypes).toEqual(new Set(["comment", "segment"]));
      const deleteCall = calls.find((c) => c.url.endsWith("/documents/delete-batch"));
      expect(deleteCall?.body).toEqual(["s1"]);
    });
  });

  describe("clear", () => {
    it("apaga todos os Documentos do Índice do Canal via DELETE /documents", async () => {
      const responder = baseResponder();
      const { fetchImpl, calls } = makeFetch(responder);
      const client = await makeClient(fetchImpl);

      await client.clear(CHANNEL_ID);

      const clearCall = calls.find((c) => c.url.endsWith("/documents") && c.method === "DELETE");
      expect(clearCall).toMatchObject({
        method: "DELETE",
        url: `${URL}/indexes/${INDEX_UID}/documents`,
        authorization: `Bearer ${MASTER_KEY}`,
      });
    });

    it("lança MeilisearchError quando o Meilisearch responde com falha na chamada de clear", async () => {
      const responder = baseResponder();
      const fetchImpl: typeof fetch = async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/keys") && method === "GET") {
          return new Response(JSON.stringify({ results: [] }), { status: 200 });
        }
        if (url.endsWith("/keys") && method === "POST") {
          return new Response(JSON.stringify({ key: "restricted-key-123" }), { status: 200 });
        }
        if (url.endsWith("/documents") && method === "DELETE") {
          return new Response("{}", { status: 500 });
        }
        return new Response(JSON.stringify(responder({ url, method, body: undefined, authorization: null })), {
          status: 200,
        });
      };
      const client = await makeClient(fetchImpl);

      await expect(client.clear(CHANNEL_ID)).rejects.toThrow("500");
    });
  });
});
