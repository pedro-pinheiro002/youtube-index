import type { SearchSort, TipoFilter } from "./types";
import { SEARCH_SORT_LABELS, SEARCH_TIPO_LABELS } from "./types";
import { SearchHitCard } from "./SearchHitCard";
import { useSearch } from "./useSearch";
import type { SearchApi } from "./useSearch";

export interface SearchViewProps {
  channelId: string;
  api: SearchApi;
}

export function SearchView({ channelId, api }: SearchViewProps) {
  const { query, setQuery, tipo, setTipo, sort, setSort, submit, results, searching, error, hasSearched } =
    useSearch({ channelId, api });

  return (
    <section aria-label="Busca">
      <h2>Busca</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label htmlFor="search-query">Buscar</label>
        <input
          id="search-query"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="palavra-chave"
        />
        <button type="submit" disabled={searching || query.trim() === ""}>
          {searching ? "Buscando..." : "Buscar"}
        </button>
      </form>

      <label htmlFor="search-tipo">Tipo</label>
      <select
        id="search-tipo"
        value={tipo}
        onChange={(event) => setTipo(event.target.value as TipoFilter)}
      >
        {(Object.keys(SEARCH_TIPO_LABELS) as TipoFilter[]).map((key) => (
          <option key={key} value={key}>
            {SEARCH_TIPO_LABELS[key]}
          </option>
        ))}
      </select>

      <label htmlFor="search-sort">Ordenar por</label>
      <select
        id="search-sort"
        value={sort}
        onChange={(event) => setSort(event.target.value as SearchSort)}
      >
        {(Object.keys(SEARCH_SORT_LABELS) as SearchSort[]).map((key) => (
          <option key={key} value={key}>
            {SEARCH_SORT_LABELS[key]}
          </option>
        ))}
      </select>

      {error && <p role="alert">{error}</p>}

      {hasSearched && results && (
        <p>
          {results.total} {results.total === 1 ? "resultado" : "resultados"} para “{results.query}”
        </p>
      )}

      {results && (
        <ul>
          {results.hits.map((hit) => (
            <li key={hit.id}>
              <SearchHitCard hit={hit} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
