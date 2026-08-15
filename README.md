# youtube-index

Aplicativo de busca local para indexar e buscar o conteúdo de um Canal do YouTube.

## Estrutura

- `packages/api` — API Fastify (`/health`, serve o frontend estático em produção)
- `packages/worker` — processo separado que executa as fases de Ingestão (health em `:8081`)
- `packages/web` — frontend React/Vite

## Desenvolvimento

```sh
pnpm install
pnpm dev
```

- web: http://localhost:5173
- api: http://localhost:3000/health
- worker: http://localhost:8081/health

## Docker compose

```sh
cp .env.example .env   # troque a MEILI_MASTER_KEY se quiser
docker compose up --build
```

Sobe `meilisearch`, `api` e `worker`, com o frontend servido estaticamente pela `api`.

- meilisearch: acessível apenas internamente (a api é a única porta de acesso)
- api: http://localhost:3000
- worker: http://localhost:8081

A master key do Meilisearch fica apenas nos contêineres do servidor — nunca no browser. A `api` serve o frontend e é a única porta de acesso ao Meilisearch.

## Comandos

```sh
pnpm typecheck   # tsc em todos os pacotes
pnpm test        # vitest em todos os pacotes
pnpm build       # build de todos os pacotes
```