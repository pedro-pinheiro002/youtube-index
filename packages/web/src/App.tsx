import { useEffect, useMemo, useState } from "react";
import { createChannel, getChannel } from "./api";
import { ChannelForm } from "./ChannelForm";
import { ProgressView } from "./ProgressView";
import type { ChannelApi } from "./useChannel";
import { useChannel } from "./useChannel";
import { isTerminalStatus } from "./types";

export interface AppProps {
  api?: ChannelApi;
  pollIntervalMs?: number;
}

const DEFAULT_API: ChannelApi = { createChannel, getChannel };

export function App({ api, pollIntervalMs }: AppProps) {
  const [apiOk, setApiOk] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/health")
      .then((res) => setApiOk(res.ok))
      .catch(() => setApiOk(false));
  }, []);

  const apiClient = useMemo(() => api ?? DEFAULT_API, [api]);

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
    </main>
  );
}