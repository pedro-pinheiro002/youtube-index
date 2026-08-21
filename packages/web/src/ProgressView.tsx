import type { ChannelWithPhases, PhaseKey, PhaseProgress } from "./types";
import { PHASES, formatProgress } from "./types";
import type { PhaseMeta } from "./types";
import { cn } from "./lib/utils";

export { formatProgress } from "./types";

export const CHANNEL_STATUS_LABELS: Record<ChannelWithPhases["status"], string> = {
  queued: "Na fila",
  ingesting: "Ingerindo",
  completed: "Concluído",
  failed: "Falhou",
};

export const PHASE_STATUS_LABELS: Record<ChannelWithPhases["phases"][PhaseKey]["status"], string> = {
  pending: "Pendente",
  running: "Rodando",
  completed: "Concluída",
  failed: "Falhou",
};

export function describeActivity(
  channel: ChannelWithPhases,
  phases: readonly PhaseMeta[] = PHASES,
): string | null {
  if (channel.status === "queued") {
    return "Na fila, aguardando o processador…";
  }
  if (channel.status === "ingesting") {
    const running = phases.find((phase) => channel.phases[phase.key].status === "running");
    if (!running) {
      return "Preparando…";
    }
    return running.describe(channel.phases[running.key]);
  }
  // `failed` returns null: FailureState renders the lastError separately, so
  // surfacing it again here would show the same message twice with different styling.
  return null;
}

export interface ProgressViewProps {
  channel: ChannelWithPhases;
  phases?: readonly PhaseMeta[];
}

function progressPercent(done: number, total: number | null): number | null {
  if (total === null || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function PhaseBar({ phase, progress }: { phase: PhaseMeta; progress: PhaseProgress }) {
  const percent = progressPercent(progress.done, progress.total);
  const indeterminate = percent === null;
  const statusLabel = PHASE_STATUS_LABELS[progress.status];
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {phase.label} <span className="text-foreground/60">— {statusLabel}</span>
        </span>
        <span
          className="font-mono tabular-nums text-foreground/80"
          data-testid={`phase-counter-${phase.key}`}
        >
          {formatProgress(progress.done, progress.total)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${phase.label}: ${statusLabel}`}
        aria-valuemin={0}
        aria-valuemax={progress.total ?? undefined}
        aria-valuenow={progress.done}
        className="h-1 w-full overflow-hidden rounded-full bg-zinc-800"
      >
        <div
          className={cn(
            "h-full rounded-full",
            indeterminate ? "w-1/3 bg-zinc-600" : "bg-primary",
          )}
          style={{ width: indeterminate ? "33%" : `${percent}%` }}
        />
      </div>
    </li>
  );
}

function PulsingDot({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span
      aria-label="polling ativo"
      data-testid="polling-dot"
      className="inline-block h-2 w-2 rounded-full bg-emerald-500"
    />
  );
}

function FailureState({
  channel,
  failedPhaseLabel,
}: {
  channel: ChannelWithPhases;
  failedPhaseLabel?: string;
}) {
  const phaseLabel = failedPhaseLabel ?? "uma das Fases";
  return (
    <div
      role="alert"
      data-testid="ingestion-failure"
      className="rounded-md border border-destructive/40 bg-destructive/5 p-3"
    >
      <p className="text-sm font-medium text-destructive">Falha na Fase de {phaseLabel}</p>
      {channel.lastError && (
        <p className="mt-1 text-sm text-foreground/80">{channel.lastError}</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Investigue a mensagem acima e tente novamente. O estado parcial do Canal foi preservado.
      </p>
    </div>
  );
}

export function ProgressView({ channel, phases = PHASES }: ProgressViewProps) {
  const activity = describeActivity(channel, phases);
  const isPolling = channel.status !== "completed" && channel.status !== "failed";
  const failedPhaseLabel =
    channel.status === "failed"
      ? phases.find((p) => channel.phases[p.key].status === "failed")?.label
      : undefined;

  return (
    <section aria-label="Progresso da Ingestão" className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold leading-tight text-foreground">
            {channel.title}
          </h2>
          <p className="text-xs text-muted-foreground">
            {channel.handle} — {CHANNEL_STATUS_LABELS[channel.status]}
          </p>
        </div>
        <PulsingDot active={isPolling} />
      </header>

      {activity && (
        <p
          className="font-mono text-xs text-muted-foreground"
          data-testid="ingestion-activity"
        >
          {activity}
        </p>
      )}

      {channel.status === "failed" && (
        <FailureState channel={channel} failedPhaseLabel={failedPhaseLabel} />
      )}

      <ul className="flex flex-col gap-3" role="list">
        {phases.map((phase) => (
          <PhaseBar key={phase.key} phase={phase} progress={channel.phases[phase.key]} />
        ))}
      </ul>
    </section>
  );
}
