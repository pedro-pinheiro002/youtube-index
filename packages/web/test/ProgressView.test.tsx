import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressView, describeActivity, PHASE_STATUS_LABELS } from "../src/ProgressView";
import { makeChannelWithPhases } from "./helpers";

describe("ProgressView", () => {
  it("preserva a acessibilidade: section com aria-label 'Progresso da Ingestão'", () => {
    render(<ProgressView channel={makeChannelWithPhases({ status: "ingesting" })} />);

    expect(screen.getByRole("region", { name: "Progresso da Ingestão" })).toBeInTheDocument();
  });

  it("mostra o título do Canal e o status traduzido", () => {
    render(<ProgressView channel={makeChannelWithPhases({ status: "ingesting" })} />);

    expect(screen.getByRole("heading", { name: "Funky Black Cat" })).toBeInTheDocument();
    expect(screen.getByText(/@funkyblackcat/)).toBeInTheDocument();
    expect(screen.getByText(/— Ingerindo/)).toBeInTheDocument();
  });

  it("renderiza uma barra slim por Fase de Ingestão na ordem do registry", () => {
    const channel = makeChannelWithPhases({ status: "ingesting" });
    render(<ProgressView channel={channel} />);

    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(3);
    expect(bars[0]).toHaveAttribute("aria-label", "Vídeos: Pendente");
    expect(bars[1]).toHaveAttribute("aria-label", "Comentários: Pendente");
    expect(bars[2]).toHaveAttribute("aria-label", "Transcrições: Pendente");
  });

  it("define a largura da barra proporcional a done/total quando total é conhecido", () => {
    const channel = makeChannelWithPhases({
      status: "ingesting",
      phases: {
        videos: { phase: "videos", status: "running", done: 1, total: 4 },
        comments: { phase: "comments", status: "pending", done: 0, total: null },
        transcripts: { phase: "transcripts", status: "pending", done: 0, total: null },
      },
    });
    render(<ProgressView channel={channel} />);

    const bar = screen.getByRole("progressbar", { name: "Vídeos: Rodando" });
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "4");
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    const fill = bar.querySelector("div");
    expect(fill).toHaveStyle({ width: "25%" });
  });

  it("renderiza a barra em estado indeterminado quando total é null", () => {
    const channel = makeChannelWithPhases({
      status: "ingesting",
      phases: {
        videos: { phase: "videos", status: "pending", done: 0, total: null },
        comments: { phase: "comments", status: "pending", done: 0, total: null },
        transcripts: { phase: "transcripts", status: "pending", done: 0, total: null },
      },
    });
    render(<ProgressView channel={channel} />);

    const bar = screen.getByRole("progressbar", { name: "Vídeos: Pendente" });
    const fill = bar.querySelector("div");
    expect(fill).toHaveStyle({ width: "33%" });
    expect(fill).not.toHaveClass("bg-primary");
  });

  it("renderiza os contadores em fonte monospace com Intl.NumberFormat('pt-BR')", () => {
    const channel = makeChannelWithPhases({
      status: "ingesting",
      phases: {
        videos: { phase: "videos", status: "completed", done: 1234, total: 5678 },
        comments: { phase: "comments", status: "running", done: 1500, total: null },
        transcripts: { phase: "transcripts", status: "pending", done: 0, total: null },
      },
    });
    render(<ProgressView channel={channel} />);

    const videosCounter = screen.getByTestId("phase-counter-videos");
    expect(videosCounter).toHaveTextContent("1.234/5.678");
    expect(videosCounter).toHaveClass("font-mono");

    const commentsCounter = screen.getByTestId("phase-counter-comments");
    expect(commentsCounter).toHaveTextContent("1.500 processados");
    expect(commentsCounter).toHaveClass("font-mono");

    const transcriptsCounter = screen.getByTestId("phase-counter-transcripts");
    expect(transcriptsCounter).toHaveTextContent("—");
    expect(transcriptsCounter).toHaveClass("font-mono");
  });

  it("renderiza a activity atual em fonte monospace quando o Canal está ingerindo", () => {
    const channel = makeChannelWithPhases({
      status: "ingesting",
      phases: {
        videos: { phase: "videos", status: "completed", done: 1, total: 1 },
        comments: { phase: "comments", status: "running", done: 3, total: 10 },
        transcripts: { phase: "transcripts", status: "pending", done: 0, total: null },
      },
    });
    render(<ProgressView channel={channel} />);

    const activity = screen.getByTestId("ingestion-activity");
    expect(activity).toHaveTextContent(/Buscando comentários \(3\/10\)…/);
    expect(activity).toHaveClass("font-mono");
  });

  it("renderiza a activity da fila em fonte monospace", () => {
    render(<ProgressView channel={makeChannelWithPhases({ status: "queued" })} />);

    const activity = screen.getByTestId("ingestion-activity");
    expect(activity).toHaveTextContent(/Na fila, aguardando o processador/);
    expect(activity).toHaveClass("font-mono");
  });

  it("exibe o dot de polling quando o Canal está em status não-terminal (Na fila)", () => {
    render(<ProgressView channel={makeChannelWithPhases({ status: "queued" })} />);

    expect(screen.getByTestId("polling-dot")).toBeInTheDocument();
    expect(screen.getByLabelText("polling ativo")).toBeInTheDocument();
  });

  it("exibe o dot de polling quando o Canal está Ingerindo", () => {
    render(<ProgressView channel={makeChannelWithPhases({ status: "ingesting" })} />);

    expect(screen.getByTestId("polling-dot")).toBeInTheDocument();
  });

  it("não exibe o dot de polling quando o Canal está Concluído", () => {
    render(<ProgressView channel={makeChannelWithPhases({ status: "completed" })} />);

    expect(screen.queryByTestId("polling-dot")).not.toBeInTheDocument();
  });

  it("não exibe o dot de polling quando o Canal Falhou", () => {
    render(
      <ProgressView
        channel={makeChannelWithPhases({
          status: "failed",
          lastError: "boom",
          phases: {
            videos: { phase: "videos", status: "failed", done: 0, total: null },
            comments: { phase: "comments", status: "pending", done: 0, total: null },
            transcripts: { phase: "transcripts", status: "pending", done: 0, total: null },
          },
        })}
      />,
    );

    expect(screen.queryByTestId("polling-dot")).not.toBeInTheDocument();
  });

  it("não renderiza a activity em fonte mono quando o Canal Falhou (evita duplicar o lastError)", () => {
    render(
      <ProgressView
        channel={makeChannelWithPhases({
          status: "failed",
          lastError: "boom",
          phases: {
            videos: { phase: "videos", status: "failed", done: 0, total: null },
            comments: { phase: "comments", status: "pending", done: 0, total: null },
            transcripts: { phase: "transcripts", status: "pending", done: 0, total: null },
          },
        })}
      />,
    );

    expect(screen.queryByTestId("ingestion-activity")).not.toBeInTheDocument();
  });

  it("renderiza o bloco de falha com a Fase que falhou, lastError e orientação ao usuário", () => {
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

    const failure = screen.getByTestId("ingestion-failure");
    expect(failure).toHaveAttribute("role", "alert");
    expect(failure).toHaveTextContent("Falha na Fase de Vídeos");
    expect(failure).toHaveTextContent("YouTube API respondeu 403 para handle '@x'");
    expect(failure).toHaveTextContent(/Investigue a mensagem acima/);
  });

  it("bloco de falha identifica a Fase correta quando Comentários é quem falhou", () => {
    render(
      <ProgressView
        channel={makeChannelWithPhases({
          status: "failed",
          lastError: "Falha de rede",
          phases: {
            videos: { phase: "videos", status: "completed", done: 10, total: 10 },
            comments: { phase: "comments", status: "failed", done: 2, total: 10 },
            transcripts: { phase: "transcripts", status: "pending", done: 0, total: null },
          },
        })}
      />,
    );

    const failure = screen.getByTestId("ingestion-failure");
    expect(failure).toHaveTextContent("Falha na Fase de Comentários");
    expect(failure).toHaveTextContent("Falha de rede");
  });

  it("renderiza a barra 100% quando a Fase está concluída", () => {
    const channel = makeChannelWithPhases({
      status: "completed",
      phases: {
        videos: { phase: "videos", status: "completed", done: 10, total: 10 },
        comments: { phase: "comments", status: "completed", done: 50, total: 50 },
        transcripts: { phase: "transcripts", status: "completed", done: 8, total: 8 },
      },
    });
    render(<ProgressView channel={channel} />);

    const bars = screen.getAllByRole("progressbar");
    bars.forEach((bar) => {
      expect(bar.querySelector("div")).toHaveStyle({ width: "100%" });
    });
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

  it("devolve null em status failed para não duplicar o lastError do FailureState", () => {
    const channel = makeChannelWithPhases({
      status: "failed",
      lastError: "boom",
      phases: {
        videos: { phase: "videos", status: "failed", done: 0, total: null },
        comments: { phase: "comments", status: "pending", done: 0, total: null },
        transcripts: { phase: "transcripts", status: "pending", done: 0, total: null },
      },
    });

    expect(describeActivity(channel, fakePhases)).toBeNull();
  });
});
