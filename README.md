# youtube-index

Aplicativo de busca local para indexar e buscar o conteúdo de um Canal do YouTube.

## Estrutura

- `packages/domain` — domínio compartilhado: schema SQLite (Fonte da verdade), Ledger e clientes de portas
- `packages/api` — API Fastify (`/health`, `/channels`, serve o frontend estático em produção)
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

### Variáveis de ambiente

Copie `.env.example` para `.env` e ajuste:

- `MEILI_MASTER_KEY` — master key do Meilisearch (fica apenas no servidor)
- `YOUTUBE_API_KEY` — chave da YouTube Data API (resolução de handle e Ingestão)
- `DB_PATH` — caminho do SQLite (Fonte da verdade); padrão `data/youtube-index.db`

### Endpoints

- `POST /channels {"handle":"@funkyblackcat"}` — resolve o `channelId`, cria o Canal no SQLite e enfileira um job de Ingestão
- `GET /channels/:id` — status do Canal e progresso por Fase (vídeos, Comentários, Transcrições)

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