import type { ChannelStatus, ChannelWithPhases, PhaseStatus } from "./types";
import { PHASES, PHASE_LABELS } from "./types";

export const CHANNEL_STATUS_LABELS: Record<ChannelStatus, string> = {
  queued: "Na fila",
  ingesting: "Ingerindo",
  completed: "Concluído",
  failed: "Falhou",
};

export const PHASE_STATUS_LABELS: Record<PhaseStatus, string> = {
  pending: "Pendente",
  running: "Rodando",
  completed: "Concluída",
  failed: "Falhou",
};

export function formatProgress(done: number, total: number | null): string {
  if (total === null) {
    return done > 0 ? `${done} processados` : "—";
  }
  return `${done}/${total}`;
}

export interface ProgressViewProps {
  channel: ChannelWithPhases;
}

export function ProgressView({ channel }: ProgressViewProps) {
  return (
    <section aria-label="Progresso da Ingestão">
      <h2>{channel.title}</h2>
      <p>
        <span>{channel.handle}</span> — status: {CHANNEL_STATUS_LABELS[channel.status]}
      </p>
      <ul>
        {PHASES.map((phase) => {
          const progress = channel.phases[phase];
          return (
            <li key={phase}>
              <span>{PHASE_LABELS[phase]}</span>: {PHASE_STATUS_LABELS[progress.status]} (
              {formatProgress(progress.done, progress.total)})
            </li>
          );
        })}
      </ul>
    </section>
  );
}