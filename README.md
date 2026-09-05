# youtube-index

Aplicativo de busca local para indexar e buscar o conteúdo de um Canal do YouTube.

## Estrutura

- `packages/domain` — domínio compartilhado: schema Postgres (única Fonte da verdade), `PostgresLedger`, `PostgresIngestionQueue`, `PostgresSearchProjection` (tsvector + ts_rank + pg_trgm fallback), e o `JobListener` que acorda o loop em-processo por `LISTEN`/`NOTIFY`
- `packages/api` — API Fastify (`/health`, `/channels`, `/search`, serve o frontend estático em produção). Roda o loop de Ingestão em-processo (`setInterval` + `LISTEN ingestion_jobs`)
- `packages/web` — frontend React/Vite

> Sem Meilisearch, sem SQLite, sem pacote `worker` separado — tudo passa por um único Postgres. Veja `docs/adr/0005-postgres-unico-store.md`.

## Desenvolvimento

O `pnpm dev` roda a `api` e o `web` no host. O Postgres roda via Docker:

```sh
docker compose up -d postgres
pnpm dev
```

- web: http://localhost:5173
- api: http://localhost:3000/health

### Variáveis de ambiente

Copie `.env.example` para `.env` e ajuste:

- `DATABASE_URL` — string de conexão Postgres (padrão `postgres://postgres:postgres@localhost:5432/youtube_index`)
- `YOUTUBE_API_KEY` — chave da YouTube Data API (resolução de handle e Ingestão)
- `POLL_INTERVAL_MS` — intervalo do `setInterval` do loop em-processo (padrão `1000`); o `NOTIFY ingestion_jobs` acorda o loop imediatamente
- `HOST`, `PORT` — endereço/porta da api
- `WEB_DIST_DIR` — diretório do build estático do web (vazio em dev)

### Endpoints

- `POST /channels {"handle":"@funkyblackcat"}` — resolve o `channelId`, cria o Canal no Postgres e enfileira um job de Ingestão (acorda o loop em-processo via `NOTIFY`)
- `GET /channels/:id` — status do Canal e progresso por Fase (vídeos, Comentários, Transcrições)
- `GET /search?q=&channelId=&tipo=&sort=` — busca lexical `tsvector @@ websearch_to_tsquery` ranqueada por `ts_rank`, com fallback `pg_trgm` quando o lexical não casa; devolve Documentos com highlight (`ts_headline`) em `_formatted` (`channelId` é obrigatório; `tipo` ∈ `video|comment|segment`; `sort` ∈ `relevance|publishedAt`)

## Docker compose

```sh
cp .env.example .env   # ajuste YOUTUBE_API_KEY se quiser
docker compose up --build
```

Sobe `postgres` (com volume `pg_data`) e `api` (com o frontend servido estaticamente).

- postgres: `localhost:5432`
- api: http://localhost:3000

## Comandos

```sh
pnpm typecheck   # tsc em todos os pacotes
pnpm test        # vitest em todos os pacotes
pnpm build       # build de todos os pacotes
```
