import { useEffect, useMemo, useState } from "react";
import { createChannel, getChannel, searchChannel } from "./api";
import { ChannelForm } from "./ChannelForm";
import { ProgressView } from "./ProgressView";
import { SearchView } from "./SearchView";
import type { ChannelApi } from "./useChannel";
import { useChannel } from "./useChannel";
import type { SearchApi } from "./useSearch";
import { isTerminalStatus } from "./types";

export interface AppProps {
  api?: ChannelApi;
  searchApi?: SearchApi;
  pollIntervalMs?: number;
}

const DEFAULT_API: ChannelApi = { createChannel, getChannel };
const DEFAULT_SEARCH_API: SearchApi = { searchChannel };

export function App({ api, searchApi, pollIntervalMs }: AppProps) {
  const [apiOk, setApiOk] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/health")
      .then((res) => setApiOk(res.ok))
      .catch(() => setApiOk(false));
  }, []);

  const apiClient = useMemo(() => api ?? DEFAULT_API, [api]);
  const searchClient = useMemo(() => searchApi ?? DEFAULT_SEARCH_API, [searchApi]);

  const { channel, submitting, error, submit } = useChannel({
    api: apiClient,
    pollIntervalMs,
  });

  const ingesting = channel !== null && !isTerminalStatus(channel.status);

  return (
    <main>
      <h1>youtube-index</h1>
      <p>Busca local para o conteúdo de um canal do YouTube.</p>
      <p>
        API: {apiOk === null ? "verificando..." : apiOk ? "ok" : "indisponível"}
      </p>

      <ChannelForm onSubmit={submit} submitting={submitting} disabled={ingesting} />

      {error && <p role="alert">{error}</p>}
      {channel && <ProgressView channel={channel} />}
      {channel && <SearchView channelId={channel.id} api={searchClient} />}
    </main>
  );
}