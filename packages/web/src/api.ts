import type { ChannelWithPhases } from "./types";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    throw new Error(body?.error ?? `Falha na requisição (${res.status})`);
  }
  return body as T;
}

export function createChannel(handle: string): Promise<ChannelWithPhases> {
  return requestJson<ChannelWithPhases>("/channels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle }),
  });
}

export function getChannel(id: string): Promise<ChannelWithPhases> {
  return requestJson<ChannelWithPhases>(`/channels/${encodeURIComponent(id)}`);
}