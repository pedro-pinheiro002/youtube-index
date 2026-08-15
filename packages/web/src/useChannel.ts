import { useCallback, useEffect, useState } from "react";
import type { ChannelWithPhases } from "./types";
import { isTerminalStatus } from "./types";

export interface ChannelApi {
  createChannel: (handle: string) => Promise<ChannelWithPhases>;
  getChannel: (id: string) => Promise<ChannelWithPhases>;
}

export interface UseChannelOptions {
  api: ChannelApi;
  pollIntervalMs?: number;
}

const MAX_CONSECUTIVE_POLL_ERRORS = 3;

export function useChannel({ api, pollIntervalMs = 2000 }: UseChannelOptions) {
  const [channel, setChannel] = useState<ChannelWithPhases | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (handle: string) => {
      setSubmitting(true);
      setError(null);
      try {
        const created = await api.createChannel(handle);
        setChannel(created);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Falha ao criar o canal");
        setChannel(null);
      } finally {
        setSubmitting(false);
      }
    },
    [api],
  );

  useEffect(() => {
    if (!channel || isTerminalStatus(channel.status)) {
      return;
    }
    const channelId = channel.id;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let consecutiveErrors = 0;

    const poll = async () => {
      if (cancelled) {
        return;
      }
      try {
        const fresh = await api.getChannel(channelId);
        if (cancelled) {
          return;
        }
        consecutiveErrors = 0;
        setChannel(fresh);
        if (!isTerminalStatus(fresh.status)) {
          timer = setTimeout(poll, pollIntervalMs);
        }
      } catch {
        consecutiveErrors += 1;
        if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          setError("Falha ao consultar o progresso do Canal");
          return;
        }
        if (!cancelled) {
          timer = setTimeout(poll, pollIntervalMs);
        }
      }
    };

    timer = setTimeout(poll, pollIntervalMs);
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [api, pollIntervalMs, channel]);

  return { channel, submitting, error, submit };
}