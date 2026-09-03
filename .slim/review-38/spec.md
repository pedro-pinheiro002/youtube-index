# Issue #38 — Spec body

Part of #33

## What to build

SearchView tem input sticky com backdrop-blur (`sticky top-0 z-10 backdrop-blur-md bg-zinc-950/80` ou `bg-zinc-50/80` em light). Filtro Tipo vira segmented control com 4 opções (Todos / Vídeo / Comentário / Transcrição) que wrappa para grid 2×2 abaixo do breakpoint `sm`. Ordenar por vira dropdown menu do shadcn. Indicador "buscando…" aparece em fonte mono sob o input durante o fetch. Estado vazio renderiza mensagem "Nenhum Documento encontrado para X" quando `results.total === 0`.

## Acceptance criteria

- [ ] Input de busca é `sticky top-0 z-10` com `backdrop-blur-md bg-zinc-950/80` (light: `bg-zinc-50/80`) sobre os resultados
- [ ] Segmented control do Tipo: `Button` shadcn em grupo, valor ativo destacado com violeta; wrappa para grid 2×2 abaixo de `sm` (via `useMediaQuery`)
- [ ] Ordenar por: shadcn `DropdownMenu` mostrando as duas opções do `SEARCH_SORT_LABELS`
- [ ] Texto "buscando…" em fonte mono aparece sob o input enquanto `searching === true`
- [ ] Quando `results !== null && results.total === 0`, renderiza "Nenhum Documento encontrado para {query}"
- [ ] Estado de erro continua renderizando com `role="alert"`
- [ ] Handlers de teclado do input: Enter chama `submit()` (bypass debounce), Esc chama `clear()` (do useSearch)
- [ ] Testes de `SearchView` validam: input sticky presente; troca de tipo re-query; troca de sort re-query; empty state aparece quando total é 0; "buscando…" aparece durante fetch
- [ ] `pnpm --filter @youtube-index/web test` passa

## Blocked by

#34, #35, #37