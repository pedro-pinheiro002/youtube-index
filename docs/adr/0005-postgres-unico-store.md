# Postgres único: fonte da verdade e busca no mesmo banco

Decidido durante a sessão de `/grilling` de 2026-09-02.

Substituímos o par SQLite + Meilisearch + Worker por um único Postgres. O conteúdo (Vídeos, Comentários, Segmentos) e a Busca vivem no mesmo banco: cada Documento carrega uma coluna `tsvector` indexada por GIN, e a Busca usa `tsvector @@ tsquery` ranqueado por `ts_rank`. O `Worker` deixou de ser um contêiner separado e virou um consumidor in-process dentro do backend, alimentado por `LISTEN/NOTIFY` + polling sobre uma Fila de Ingestão em Postgres.

A `Ingestão` agora é atômica: gravar a linha-fonte e popular `tsvector` acontece na mesma transação, eliminando a janela de inconsistência entre "está no SQLite mas ainda não no Meilisearch".

Aceitamos perder o BM25 nativo do Meilisearch — `ts_rank` é um heurístico TF sem IDF, ranking pior em queries longas. Para tolerância a erros de digitação adicionamos `pg_trgm` (extensão de core contrib) como **fallback** acionado só quando `tsquery` retorna zero resultados; não compomos scores, é uma segunda chance, não um blend.

## Status

Aceito. Supersede ADR-0001.

## Considered Options

- **Postgres + `pg_search` (ParadeDB)** — BM25 real (k1=1.2, b=0.75) via Tantivy, mas é uma extensão pesada (AGPL, `shared_preload_libraries`), exatamente o tipo de dependência que a sessão queria remover. Rejeitado.
- **Postgres + `pg_textsearch`** — BM25 nativo (Tiger Data), licença Postgres, mas mesma categoria de "extensão nova a carregar". Rejeitado pela mesma razão.
- **Manter Meilisearch, migrar só SQLite → Postgres** — preserva a qualidade de ranking, mas mantém dois sistemas e duas projeções. Rejeitado: o objetivo da sessão era consolidar.
- **Trigrama como match primário, sem tsvector** — mais simples, mas perde stemming ("running" não casa com "run") e a relevância fica pior que `tsvector` mesmo. Rejeitado.
- **Compor scores com UNION ponderado (`0.7*ts_rank + 0.3*similarity`)** — melhor relevância, mas exige dois GIN na mesma coluna (to_tsvector + gin_trgm_ops), dobra custo de escrita na Ingestão e torna o ranking menos previsível. Rejeitado em favor do fallback simples.

## Consequences

- `docker compose` sobe só `postgres`, `api` (que serve o `web` estático) — dois serviços em vez de três.
- Ingestão é uma transação; não existe mais rebuild manual de "projeção de busca" — basta `UPDATE documentos SET fts = to_tsvector(...)` quando precisar reindexar settings.
- Ranking de Busca é pior que o do Meilisearch para queries com múltiplos termos. Aceito como tradeoff consciente.
- Busca sem acerto lexical (incluindo erros de digitação) é mais lenta: `pg_trgm` faz scan com índice GIN de trigramas, mas a busca por similaridade não é tão afinada quanto a tolerância a typos do Meilisearch. Aceito.
- `Worker` como processo separado some do `docker compose.yml`, mas continua existindo como código dentro do backend. Honesto: o trabalho assíncrono não desapareceu, só mudou de endereço.
