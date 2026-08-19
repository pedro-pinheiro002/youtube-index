import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressView, describeActivity, formatProgress, PHASE_STATUS_LABELS } from "../src/ProgressView";
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

  it("mostra a atividade atual quando o Canal está na fila", () => {
    render(<ProgressView channel={makeChannelWithPhases({ status: "queued" })} />);

    expect(screen.getByText(/Na fila, aguardando o processador/)).toBeInTheDocument();
  });

  it("mostra a atividade atual quando uma Fase está rodando", () => {
    render(
      <ProgressView
        channel={makeChannelWithPhases({
          status: "ingesting",
          phases: {
            videos: { phase: "videos", status: "completed", done: 1, total: 1 },
            comments: { phase: "comments", status: "running", done: 3, total: 10 },
            transcripts: { phase: "transcripts", status: "pending", done: 0, total: null },
          },
        })}
      />,
    );

    expect(screen.getByText(/Buscando comentários \(3\/10\)…/)).toBeInTheDocument();
  });

  it("mostra o motivo da falha quando o Canal falhou", () => {
    render(
      <ProgressView
        channel={makeChannelWithPhases({
          status: "failed",
          lastError: "YouTube API respondeu 403 para handle '@x'",
          phases: {
            videos: { phase: "videos", status: "failed", done: 0, total: null },
            comments: { phase: "comments", status: "pending", done: 0, total: null },
            transcripts: { phase: "transcripts", status: "pending", done: 0, total: null },
          },
        })}
      />,
    );

    expect(
      screen.getByText(/YouTube API respondeu 403 para handle '@x'/),
    ).toBeInTheDocument();
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

describe("describeActivity com registry fake", () => {
  const fakePhases = [
    { key: "videos" as const, label: "Vídeos", doc: "video" as const, describe: () => "Listando os vídeos do canal…" },
  ];

  it("descreve a atividade quando a Fase do registry fake está rodando", () => {
    const channel = makeChannelWithPhases({
      status: "ingesting",
      phases: {
        videos: { phase: "videos", status: "running", done: 1, total: 1 },
        comments: { phase: "comments", status: "pending", done: 0, total: null },
        transcripts: { phase: "transcripts", status: "pending", done: 0, total: null },
      },
    });

    expect(describeActivity(channel, fakePhases)).toBe("Listando os vídeos do canal…");
  });

  it("devolve Preparando quando nenhuma Fase do registry fake está rodando", () => {
    const channel = makeChannelWithPhases({
      status: "ingesting",
      phases: {
        videos: { phase: "videos", status: "pending", done: 0, total: null },
        comments: { phase: "comments", status: "pending", done: 0, total: null },
        transcripts: { phase: "transcripts", status: "pending", done: 0, total: null },
      },
    });

    expect(describeActivity(channel, fakePhases)).toBe("Preparando…");
  });
});