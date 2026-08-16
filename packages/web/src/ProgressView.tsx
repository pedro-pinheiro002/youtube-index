import type { ChannelWithPhases, PhaseKey } from "./types";
import { PHASES, PHASE_LABELS } from "./types";

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

export function formatProgress(done: number, total: number | null): string {
  if (total === null) {
    return done > 0 ? `${done} processados` : "—";
  }
  return `${done}/${total}`;
}

export function describeActivity(channel: ChannelWithPhases): string | null {
  if (channel.status === "queued") {
    return "Na fila, aguardando o processador…";
  }
  if (channel.status === "ingesting") {
    const running = PHASES.find((phase) => channel.phases[phase].status === "running");
    if (!running) {
      return "Preparando…";
    }
    const progress = channel.phases[running];
    switch (running) {
      case "videos":
        return "Listando os vídeos do canal…";
      case "comments":
        return `Buscando comentários (${formatProgress(progress.done, progress.total)})…`;
      case "transcripts":
        return `Buscando transcrições (${formatProgress(progress.done, progress.total)})…`;
    }
  }
  if (channel.status === "failed") {
    return channel.lastError ?? "Falhou durante a ingestão";
  }
  return null;
}

export interface ProgressViewProps {
  channel: ChannelWithPhases;
}

export function ProgressView({ channel }: ProgressViewProps) {
  const activity = describeActivity(channel);

  return (
    <section aria-label="Progresso da Ingestão">
      <h2>{channel.title}</h2>
      <p>
        <span>{channel.handle}</span> — status: {CHANNEL_STATUS_LABELS[channel.status]}
      </p>
      {activity && <p>{activity}</p>}
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