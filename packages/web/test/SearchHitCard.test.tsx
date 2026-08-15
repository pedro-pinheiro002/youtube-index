import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  SearchHitCard,
  formatCount,
  formatDate,
  formatStart,
  highlightHtml,
  textOf,
} from "../src/SearchHitCard";
import { makeCommentHit, makeSegmentHit, makeVideoHit } from "./helpers";

describe("SearchHitCard", () => {
  it("mostra Vídeo com thumbnail, título destacado, métricas e deep-link", () => {
    render(<SearchHitCard hit={makeVideoHit()} />);

    const link = screen.getByRole("link", { name: "Primeiro vídeo" });
    expect(link).toHaveAttribute("href", "https://www.youtube.com/watch?v=v1");
    expect(screen.getByText(/Descrição do primeiro/)).toBeInTheDocument();
    expect(screen.getByText("1.234 visualizações · 56 curtidas · 2:22 · 01/01/2026")).toBeInTheDocument();
  });

  it("mostra Comentário com contexto do Vídeo e deep-link para o Comentário", () => {
    render(<SearchHitCard hit={makeCommentHit()} />);

    const link = screen.getByRole("link", { name: "Primeiro vídeo" });
    expect(link).toHaveAttribute("href", "https://www.youtube.com/watch?v=v1&lc=c1");
    expect(screen.getByText("Gato Funky · 02/01/2026 · 12 curtidas")).toBeInTheDocument();
    expect(screen.getByRole("article")).toHaveTextContent("Comentário sobre o primeiro vídeo");
    expect(screen.getByText("1.234 visualizações · 56 curtidas")).toBeInTheDocument();
  });

  it("mostra Segmento com o momento exato, deep-link com &t= e métricas do Vídeo", () => {
    render(<SearchHitCard hit={makeSegmentHit()} />);

    const link = screen.getByRole("link", { name: "Primeiro vídeo" });
    expect(link).toHaveAttribute("href", "https://www.youtube.com/watch?v=v1&t=142s");
    expect(screen.getByRole("article")).toHaveTextContent("Trecho da transcrição");
    expect(screen.getByText("2:22 · 03/01/2026 · 1.234 visualizações · 56 curtidas")).toBeInTheDocument();
  });

  it("destaca o trecho no texto formatado", () => {
    render(<SearchHitCard hit={makeVideoHit()} />);

    const highlights = screen.getAllByText("vídeo");
    expect(highlights).toHaveLength(2);
    expect(highlights[0]?.tagName).toBe("EM");
  });
});

describe("highlightHtml", () => {
  it("restaura <em> e escapa o restante do HTML", () => {
    expect(highlightHtml("Primeiro <em>vídeo</em>")).toBe("Primeiro <em>vídeo</em>");
    expect(highlightHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });
});

describe("textOf", () => {
  it("usa o valor formatado quando presente", () => {
    const hit = makeVideoHit();
    expect(textOf(hit, "title", "fallback")).toBe("Primeiro <em>vídeo</em>");
  });

  it("usa o fallback quando o campo não está formatado", () => {
    const hit = makeVideoHit({ _formatted: undefined });
    expect(textOf(hit, "title", "Primeiro vídeo")).toBe("Primeiro vídeo");
  });
});

describe("formatCount", () => {
  it("formata números com separador pt-BR", () => {
    expect(formatCount(1234)).toBe("1.234");
    expect(formatCount(56)).toBe("56");
  });
});

describe("formatStart", () => {
  it("formata segundos como mm:ss", () => {
    expect(formatStart(142)).toBe("2:22");
    expect(formatStart(65)).toBe("1:05");
    expect(formatStart(0)).toBe("0:00");
  });
});

describe("formatDate", () => {
  it("formata a data em dd/mm/aaaa", () => {
    expect(formatDate("2026-01-01T00:00:00.000Z")).toBe("01/01/2026");
  });
});
