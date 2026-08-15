import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressView, formatProgress, PHASE_STATUS_LABELS } from "../src/ProgressView";
import { makeChannelWithPhases } from "./helpers";

describe("ProgressView", () => {
  it("mostra o status do Canal", () => {
    render(<ProgressView channel={makeChannelWithPhases({ status: "ingesting" })} />);

    expect(screen.getByText("Funky Black Cat")).toBeInTheDocument();
    expect(screen.getByText(/status: Ingerindo/)).toBeInTheDocument();
  });

  it("mostra o progresso de cada Fase", () => {
    const channel = makeChannelWithPhases({
      status: "ingesting",
      phases: {
        videos: { phase: "videos", status: "completed", done: 10, total: 10 },
        comments: { phase: "comments", status: "running", done: 3, total: 10 },
        transcripts: { phase: "transcripts", status: "pending", done: 0, total: null },
      },
    });
    render(<ProgressView channel={channel} />);

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Vídeos: Concluída (10/10)");
    expect(items[1]).toHaveTextContent("Comentários: Rodando (3/10)");
    expect(items[2]).toHaveTextContent("Transcrições: Pendente (—)");
  });
});

describe("formatProgress", () => {
  it("formata done/total quando total é conhecido", () => {
    expect(formatProgress(3, 10)).toBe("3/10");
  });

  it("mostra placeholder quando total é desconhecido", () => {
    expect(formatProgress(0, null)).toBe("—");
  });

  it("mostra contagem parcial quando total é desconhecido", () => {
    expect(formatProgress(5, null)).toBe("5 processados");
  });
});

describe("PHASE_STATUS_LABELS", () => {
  it("traduz todos os status de Fase", () => {
    expect(PHASE_STATUS_LABELS).toEqual({
      pending: "Pendente",
      running: "Rodando",
      completed: "Concluída",
      failed: "Falhou",
    });
  });
});