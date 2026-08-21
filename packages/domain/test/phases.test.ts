import { describe, expect, it } from "vitest";
import { formatProgress, PHASES } from "../src/phases.js";
import { createPhases } from "../src/ingestion.js";
import type { PhaseKey, PhaseProgress } from "../src/types.js";

const PHASE_KEYS: readonly PhaseKey[] = ["videos", "comments", "transcripts"];

describe("PHASES registry", () => {
  it("não está vazio", () => {
    expect(PHASES.length).toBeGreaterThan(0);
  });

  it("cada entrada tem label não-vazio, doc válido, describe função e key válida", () => {
    for (const phase of PHASES) {
      expect(phase.label.length).toBeGreaterThan(0);
      expect(["video", "comment", "segment"]).toContain(phase.doc);
      expect(typeof phase.describe).toBe("function");
      expect(PHASE_KEYS).toContain(phase.key);
    }
  });

  it("as keys são únicas", () => {
    const keys = PHASES.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("a ordem é videos → comments → transcripts", () => {
    expect(PHASES.map((p) => p.key)).toEqual(["videos", "comments", "transcripts"]);
  });
});

describe("formatProgress", () => {
  it("formata done/total quando total é conhecido", () => {
    expect(formatProgress(3, 10)).toBe("3/10");
  });

  it("mostra placeholder quando total é desconhecido e done é zero", () => {
    expect(formatProgress(0, null)).toBe("—");
  });

  it("mostra contagem parcial quando total é desconhecido e done > 0", () => {
    expect(formatProgress(5, null)).toBe("5 processados");
  });

  it("formata números >= 1000 com separador de milhar pt-BR", () => {
    expect(formatProgress(1234, 5678)).toBe("1.234/5.678");
    expect(formatProgress(1500, null)).toBe("1.500 processados");
  });
});

describe("describe por Fase", () => {
  it("videos descreve a listagem de vídeos independente do progresso", () => {
    const videos = PHASES.find((p) => p.key === "videos");
    expect(videos).toBeDefined();
    const progress: PhaseProgress = { phase: "videos", status: "running", done: 3, total: 10 };
    expect(videos!.describe(progress)).toBe("Listando os vídeos do canal…");
  });

  it("comments descreve a busca de comentários com progresso", () => {
    const comments = PHASES.find((p) => p.key === "comments");
    expect(comments).toBeDefined();
    const progress: PhaseProgress = { phase: "comments", status: "running", done: 3, total: 10 };
    expect(comments!.describe(progress)).toBe("Buscando comentários (3/10)…");
  });

  it("transcripts descreve a busca de transcrições com progresso", () => {
    const transcripts = PHASES.find((p) => p.key === "transcripts");
    expect(transcripts).toBeDefined();
    const progress: PhaseProgress = { phase: "transcripts", status: "running", done: 5, total: null };
    expect(transcripts!.describe(progress)).toBe("Buscando transcrições (5 processados)…");
  });
});

describe("createPhases", () => {
  it("devolve entradas com run função e keys na mesma ordem de PHASES", () => {
    const fakeDeps = {
      youtube: {} as never,
      transcripts: {} as never,
      ledger: {} as never,
      projection: {} as never,
    };
    const phases = createPhases(fakeDeps);
    expect(phases.map((p) => p.key)).toEqual(PHASES.map((p) => p.key));
    for (const phase of phases) {
      expect(typeof phase.run).toBe("function");
    }
  });
});
