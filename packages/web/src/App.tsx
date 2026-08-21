import { useEffect, useMemo, useState } from "react";
import { createChannel, getChannel, searchChannel } from "./api";
import { ChannelForm } from "./ChannelForm";
import { ProgressView } from "./ProgressView";
import { SearchView } from "./SearchView";
import {
  Tooltip,
  TooltipPopup,
  TooltipPortal,
  TooltipPositioner,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip";
import type { ChannelApi } from "./useChannel";
import { useChannel } from "./useChannel";
import type { SearchApi } from "./useSearch";
import { isTerminalStatus } from "./types";
import type { Theme } from "./useTheme";
import { useTheme } from "./useTheme";

export interface AppProps {
  api?: ChannelApi;
  searchApi?: SearchApi;
  pollIntervalMs?: number;
}

const DEFAULT_API: ChannelApi = { createChannel, getChannel };
const DEFAULT_SEARCH_API: SearchApi = { searchChannel };

const BASE_TITLE = "youtube-index";

const HEALTH_DOT_STYLES: Record<"checking" | "ok" | "down", string> = {
  checking: "bg-zinc-500",
  ok: "bg-emerald-500",
  down: "bg-red-500",
};

const HEALTH_DOT_LABELS: Record<"checking" | "ok" | "down", string> = {
  checking: "verificando…",
  ok: "ok",
  down: "indisponível",
};

type HealthState = "checking" | "ok" | "down";

function healthStateOf(apiOk: boolean | null): HealthState {
  if (apiOk === null) return "checking";
  return apiOk ? "ok" : "down";
}

function HealthDot({ apiOk }: { apiOk: boolean | null }) {
  const state = healthStateOf(apiOk);
  const label = HEALTH_DOT_LABELS[state];
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={label}
        className={`absolute right-4 top-4 inline-block h-2 w-2 rounded-full sm:right-6 md:right-8 ${HEALTH_DOT_STYLES[state]}`}
      />
      <TooltipPortal>
        <TooltipPositioner side="bottom" align="end">
          <TooltipPopup>{label}</TooltipPopup>
        </TooltipPositioner>
      </TooltipPortal>
    </Tooltip>
  );
}

function ThemeToggleButton({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="alternar tema"
      className="absolute right-12 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:right-14 md:right-16"
    >
      <span aria-hidden="true">{theme === "dark" ? "☾" : "☀"}</span>
    </button>
  );
}

export function App({ api, searchApi, pollIntervalMs }: AppProps) {
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const { theme, toggle: toggleTheme } = useTheme();

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

  useEffect(() => {
    document.title = channel ? `${BASE_TITLE} — ${channel.handle}` : BASE_TITLE;
  }, [channel]);

  const ingesting = channel !== null && !isTerminalStatus(channel.status);
  const variant = channel === null ? "hero" : "compact";

  return (
    <TooltipProvider>
      <main className="relative mx-auto max-w-3xl px-4 py-8 sm:px-6 md:px-8">
        <HealthDot apiOk={apiOk} />
        <ThemeToggleButton theme={theme} onToggle={toggleTheme} />

        <ChannelForm
          variant={variant}
          onSubmit={submit}
          submitting={submitting}
          disabled={ingesting}
          error={error}
        />

        {channel && <ProgressView channel={channel} />}
        {channel && <SearchView channelId={channel.id} api={searchClient} />}
      </main>
    </TooltipProvider>
  );
}
