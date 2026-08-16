import {
  type Documento,
  FILTERABLE_ATTRIBUTES,
  type Projection,
  SEARCHABLE_ATTRIBUTES,
  SORTABLE_ATTRIBUTES,
  STOP_WORDS_PT,
} from "./documento.js";
import type { SearchParams, SearchPort, SearchResponse } from "./search.js";

export interface MeilisearchConfig {
  url: string;
  masterKey: string;
  fetchImpl?: typeof fetch;
}

interface ErrorBody {
  code?: string;
  message?: string;
}

interface KeyResponse {
  key: string;
  description: string;
}

interface KeysListResponse {
  results: KeyResponse[];
}

interface SearchResponseBody {
  hits: Array<Record<string, unknown>>;
  estimatedTotalHits: number;
}

export class MeilisearchError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, path: string, detail: string) {
    super(`Meilisearch respondeu ${status} em ${path}: ${detail}`);
    this.name = "MeilisearchError";
    this.status = status;
    this.code = code;
  }
}

export class MeilisearchProjection implements Projection, SearchPort {
  private readonly url: string;
  private readonly masterKey: string;
  private readonly fetchImpl: typeof fetch;
  private restrictedKey: string | null = null;
  private readonly ensuredIndexes = new Set<string>();

  constructor(config: MeilisearchConfig) {
    this.url = config.url.replace(/\/+$/, "");
    this.masterKey = config.masterKey;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private async request(path: string, options: { method: string; key: string; body?: unknown }): Promise<unknown> {
    const res = await this.fetchImpl(`${this.url}${path}`, {
      method: options.method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.key}`,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      let code: string | null = null;
      try {
        code = (JSON.parse(raw) as ErrorBody).code ?? null;
      } catch {
        code = null;
      }
      throw new MeilisearchError(res.status, code, path, raw);
    }
    return res.status === 204 ? undefined : res.json();
  }

  private indexUid(channelId: string): string {
    return channelId.toLowerCase();
  }

  private async ensureIndex(channelId: string): Promise<void> {
    const uid = this.indexUid(channelId);
    if (this.ensuredIndexes.has(uid)) {
      return;
    }
    let index: { primaryKey?: string | null } | undefined;
    try {
      index = (await this.request(`/indexes/${uid}`, { method: "GET", key: this.masterKey })) as {
        primaryKey?: string | null;
      };
    } catch (err) {
      if (err instanceof MeilisearchError && err.status === 404) {
        await this.request("/indexes", {
          method: "POST",
          key: this.masterKey,
          body: { uid, primaryKey: "id" },
        });
      } else {
        throw err;
      }
    }
    if (index && index.primaryKey !== "id") {
      await this.request(`/indexes/${uid}`, { method: "PATCH", key: this.masterKey, body: { primaryKey: "id" } });
    }
    await this.request(`/indexes/${uid}/settings`, {
      method: "PATCH",
      key: this.masterKey,
      body: {
        searchableAttributes: [...SEARCHABLE_ATTRIBUTES],
        filterableAttributes: [...FILTERABLE_ATTRIBUTES],
        sortableAttributes: [...SORTABLE_ATTRIBUTES],
        stopWords: [...STOP_WORDS_PT],
      },
    });
    this.ensuredIndexes.add(uid);
  }

  async addDocuments(channelId: string, documents: Documento[]): Promise<void> {
    if (documents.length === 0) {
      return;
    }
    await this.ensureIndex(channelId);
    await this.request(`/indexes/${this.indexUid(channelId)}/documents`, {
      method: "POST",
      key: this.masterKey,
      body: documents,
    });
  }

  async getOrCreateRestrictedSearchKey(description = "youtube-index search"): Promise<string> {
    const existing = (await this.request("/keys", {
      method: "GET",
      key: this.masterKey,
    })) as KeysListResponse;
    const match = existing.results.find((key) => key.description === description);
    if (match) {
      this.restrictedKey = match.key;
      return match.key;
    }

    const created = (await this.request("/keys", {
      method: "POST",
      key: this.masterKey,
      body: {
        description,
        actions: ["search"],
        indexes: ["*"],
        expiresAt: null,
      },
    })) as KeyResponse;
    this.restrictedKey = created.key;
    return created.key;
  }

  private buildSearchBody(params: SearchParams): Record<string, unknown> {
    const body: Record<string, unknown> = {
      q: params.q,
      limit: params.limit ?? 20,
      offset: 0,
      attributesToHighlight: ["*"],
      highlightPreTag: "<em>",
      highlightPostTag: "</em>",
    };
    if (params.tipo) {
      body.filter = [`type = ${params.tipo}`];
    }
    if (params.sort === "publishedAt") {
      body.sort = ["publishedAt:desc"];
    }
    return body;
  }

  async search(params: SearchParams): Promise<SearchResponse> {
    if (!this.restrictedKey) {
      throw new Error("chave restrita não configurada");
    }
    const body = this.buildSearchBody(params);

    try {
      const data = (await this.request(`/indexes/${this.indexUid(params.channelId)}/search`, {
        method: "POST",
        key: this.restrictedKey,
        body,
      })) as SearchResponseBody;
      return {
        hits: data.hits as unknown as SearchResponse["hits"],
        total: data.estimatedTotalHits,
        query: params.q,
      };
    } catch (err) {
      if (err instanceof MeilisearchError && err.code === "index_not_found") {
        return { hits: [], total: 0, query: params.q };
      }
      throw err;
    }
  }
}

export async function createMeilisearchProjection(config: MeilisearchConfig): Promise<MeilisearchProjection> {
  const projection = new MeilisearchProjection(config);
  await projection.getOrCreateRestrictedSearchKey();
  return projection;
}
