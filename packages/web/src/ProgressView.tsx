import type { ChannelWithPhases, PhaseKey } from "./types";
import { PHASES, formatProgress } from "./types";
import type { PhaseMeta } from "./types";

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
  if (channel.status === "failed") {
    return channel.lastError ?? "Falhou durante a ingestão";
  }
  return null;
}

export interface ProgressViewProps {
  channel: ChannelWithPhases;
  phases?: readonly PhaseMeta[];
}

export function ProgressView({ channel, phases = PHASES }: ProgressViewProps) {
  const activity = describeActivity(channel, phases);

  return (
    <section aria-label="Progresso da Ingestão">
      <h2>{channel.title}</h2>
      <p>
        <span>{channel.handle}</span> — status: {CHANNEL_STATUS_LABELS[channel.status]}
      </p>
      {activity && <p>{activity}</p>}
      <ul>
        {phases.map((phase) => {
          const progress = channel.phases[phase.key];
          return (
            <li key={phase.key}>
              <span>{phase.label}</span>: {PHASE_STATUS_LABELS[progress.status]} (
              {formatProgress(progress.done, progress.total)})
            </li>
          );
        })}
      </ul>
    </section>
  );
}
