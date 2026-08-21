import type { SearchSort, TipoFilter } from "./types";
import { SEARCH_SORT_LABELS, SEARCH_TIPO_LABELS } from "./types";
import { SearchHitCard } from "./SearchHitCard";
import type { SearchApi } from "./useSearch";
import { useSearch } from "./useSearch";
import { useMediaQuery } from "./useMediaQuery";
import { Button, buttonVariants } from "./components/ui/button";
import { Input } from "./components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { cn } from "./lib/utils";

const SM_QUERY = "(min-width: 640px)";

export interface SearchViewProps {
  channelId: string;
  api: SearchApi;
}

export function SearchView({ channelId, api }: SearchViewProps) {
  const {
    query,
    setQuery,
    tipo,
    setTipo,
    sort,
    setSort,
    submit,
    clear,
    results,
    searching,
    error,
    hasSearched,
  } = useSearch({ channelId, api });
  const isWide = useMediaQuery(SM_QUERY);

  const tipoEntries = Object.entries(SEARCH_TIPO_LABELS) as [TipoFilter, string][];
  const sortEntries = Object.entries(SEARCH_SORT_LABELS) as [SearchSort, string][];
  const showEmptyState = results !== null && results.total === 0;
  const submittedQuery = results?.query ?? "";

  return (
    <section aria-label="Busca" className="space-y-4">
      <h2 className="sr-only">Busca</h2>

      <div className="sticky top-0 z-10 -mx-4 bg-zinc-950/80 px-4 py-3 backdrop-blur-md light:bg-zinc-50/80 sm:-mx-6 sm:px-6 md:-mx-8 md:px-8">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label htmlFor="search-query" className="sr-only">
            Buscar
          </label>
          <Input
            id="search-query"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                clear();
              }
            }}
            placeholder="palavra-chave"
          />
        </form>
        {searching && (
          <p aria-live="polite" className="mt-2 font-mono text-xs text-muted-foreground">
            buscando…
          </p>
        )}
      </div>

      <div
        role="group"
        aria-label="Tipo"
        className={cn(isWide ? "flex flex-row gap-1" : "grid grid-cols-2 gap-2")}
      >
        {tipoEntries.map(([key, label]) => {
          const active = tipo === key;
          return (
            <Button
              key={key}
              type="button"
              variant={active ? "default" : "outline"}
              aria-pressed={active}
              onClick={() => setTipo(key)}
              className="flex-1"
            >
              {label}
            </Button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">Ordenar por</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Ordenar por: ${SEARCH_SORT_LABELS[sort]}`}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "flex-1 justify-between gap-1",
            )}
          >
            <span>{SEARCH_SORT_LABELS[sort]}</span>
            <span aria-hidden="true" className="text-xs text-muted-foreground">▾</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {sortEntries.map(([key, label]) => (
              <DropdownMenuItem key={key} onClick={() => setSort(key)}>
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {showEmptyState && (
        <p className="text-sm text-muted-foreground">
          Nenhum Documento encontrado para &quot;{submittedQuery}&quot;
        </p>
      )}

      {hasSearched && results && results.total > 0 && (
        <>
          <p className="text-sm text-muted-foreground">
            {results.total} {results.total === 1 ? "Documento" : "Documentos"} para &quot;{results.query}&quot;
          </p>
          <ul className="space-y-2">
            {results.hits.map((hit) => (
              <li key={hit.id} className="rounded-lg border border-border bg-card">
                <SearchHitCard hit={hit} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
