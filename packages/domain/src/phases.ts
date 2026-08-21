import type { SearchDocumentType } from "./documento.js";
import type { PhaseKey, PhaseProgress } from "./types.js";

export interface PhaseMeta {
  key: PhaseKey;
  label: string;
  doc: SearchDocumentType;
  describe: (progress: PhaseProgress) => string;
}

export interface Phase extends PhaseMeta {
  run: (channelId: string) => Promise<void>;
}

const ptBRNumber = new Intl.NumberFormat("pt-BR");

export function formatProgress(done: number, total: number | null): string {
  const doneText = ptBRNumber.format(done);
  if (total === null) return done > 0 ? `${doneText} processados` : "—";
  return `${doneText}/${ptBRNumber.format(total)}`;
}

export const PHASES: readonly PhaseMeta[] = [
  { key: "videos", label: "Vídeos", doc: "video", describe: () => "Listando os vídeos do canal…" },
  { key: "comments", label: "Comentários", doc: "comment", describe: (p) => `Buscando comentários (${formatProgress(p.done, p.total)})…` },
  { key: "transcripts", label: "Transcrições", doc: "segment", describe: (p) => `Buscando transcrições (${formatProgress(p.done, p.total)})…` },
];
