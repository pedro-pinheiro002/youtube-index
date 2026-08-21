import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResponse } from "../src/types";
import { SearchView } from "../src/SearchView";
import {
  makeCommentHit,
  makeSearchApi,
  makeSearchResponse,
  makeSegmentHit,
  makeVideoHit,
} from "./helpers";

const CHANNEL_ID = "UCY8iijN1AkyDCh1Z9akcqUA";

function installMatchMedia(matches: boolean) {
  const matchMedia = vi.fn().mockReturnValue({
    matches,
    media: "",
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
  return matchMedia;
}

beforeEach(() => {
  // Default to "small viewport" so the segmented control renders in the 2x2
  // grid layout. Tests that need the inline flex layout override this.
  installMatchMedia(false);
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).matchMedia;
});

describe("SearchView", () => {
  it("busca por palavra-chave e mostra resultados de todos os tipos", async () => {
    const user = userEvent.setup();
    const searchChannel = vi.fn().mockResolvedValue(
      makeSearchResponse({
        hits: [makeVideoHit(), makeCommentHit(), makeSegmentHit()],
        total: 3,
        query: "vídeo",
      }),
    );
    render(<SearchView channelId={CHANNEL_ID} api={makeSearchApi({ searchChannel })} />);

    const input = screen.getByLabelText("Buscar");
    await user.type(input, "vídeo");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findAllByRole("link", { name: "Primeiro vídeo" })).toHaveLength(3);
    expect(screen.getByText("Gato Funky · 02/01/2026 · 12 curtidas")).toBeInTheDocument();
    expect(screen.getByText("2:22 · 03/01/2026 · 1.234 visualizações · 56 curtidas")).toBeInTheDocument();
    expect(screen.getByText(/3 Documentos/)).toBeInTheDocument();
    expect(searchChannel).toHaveBeenCalledWith({ q: "vídeo", channelId: CHANNEL_ID, sort: "relevance" });
  });

  it("renderiza o input dentro de um container sticky com backdrop-blur", () => {
    render(<SearchView channelId={CHANNEL_ID} api={makeSearchApi()} />);

    const input = screen.getByLabelText("Buscar");
    // The sticky wrapper is the closest ancestor carrying the sticky/background
    // utility classes. Walking up via the DOM is more stable than querying by
    // role, since the wrapper has no semantic role.
    let wrapper: HTMLElement | null = input.parentElement;
    while (wrapper && !wrapper.className.includes("sticky")) {
      wrapper = wrapper.parentElement;
    }
    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveClass("sticky");
    expect(wrapper).toHaveClass("top-0");
    expect(wrapper).toHaveClass("z-10");
    expect(wrapper).toHaveClass("backdrop-blur-md");
    expect(wrapper).toHaveClass("bg-zinc-950/80");
    expect(wrapper).toHaveClass("light:bg-zinc-50/80");
  });

  it("exibe o filtro Tipo como segmented control com 4 opções e destaca o ativo em violeta", () => {
    render(<SearchView channelId={CHANNEL_ID} api={makeSearchApi()} />);

    const group = screen.getByRole("group", { name: "Tipo" });
    expect(group).toBeInTheDocument();
    const allButton = screen.getByRole("button", { name: "Todos" });
    const videoButton = screen.getByRole("button", { name: "Vídeo" });
    const commentButton = screen.getByRole("button", { name: "Comentário" });
    const segmentButton = screen.getByRole("button", { name: "Transcrição" });

    expect(allButton).toHaveAttribute("aria-pressed", "true");
    expect(videoButton).toHaveAttribute("aria-pressed", "false");
    expect(commentButton).toHaveAttribute("aria-pressed", "false");
    expect(segmentButton).toHaveAttribute("aria-pressed", "false");

    // The active button uses the default (violet) variant.
    expect(allButton.className).toMatch(/bg-primary/);
    expect(videoButton.className).not.toMatch(/bg-primary/);
  });

  it("trocar o tipo re-executa a busca com o filtro do tipo", async () => {
    const user = userEvent.setup();
    const searchChannel = vi.fn().mockResolvedValue(makeSearchResponse());
    render(<SearchView channelId={CHANNEL_ID} api={makeSearchApi({ searchChannel })} />);

    const input = screen.getByLabelText("Buscar");
    await user.type(input, "gato");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(searchChannel).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Comentário" }));
    await waitFor(() => expect(searchChannel).toHaveBeenCalledTimes(2));

    expect(searchChannel.mock.calls[1]?.[0]).toEqual({
      q: "gato",
      channelId: CHANNEL_ID,
      tipo: "comment",
      sort: "relevance",
    });
    expect(screen.getByRole("button", { name: "Comentário" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Todos" })).toHaveAttribute("aria-pressed", "false");
  });

  it("layout do segmented control usa grid 2x2 abaixo de sm e flex inline a partir de sm", () => {
    const { rerender } = render(<SearchView channelId={CHANNEL_ID} api={makeSearchApi()} />);
    expect(screen.getByRole("group", { name: "Tipo" }).className).toMatch(/grid-cols-2/);

    installMatchMedia(true);
    rerender(<SearchView channelId={CHANNEL_ID} api={makeSearchApi()} />);
    expect(screen.getByRole("group", { name: "Tipo" }).className).toMatch(/flex/);
    expect(screen.getByRole("group", { name: "Tipo" }).className).not.toMatch(/grid-cols-2/);
  });

  it("exibe Ordenar por como dropdown do shadcn", async () => {
    const user = userEvent.setup();
    render(<SearchView channelId={CHANNEL_ID} api={makeSearchApi()} />);

    const trigger = screen.getByRole("button", { name: /Ordenar por/ });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");

    await user.click(trigger);
    expect(await screen.findByRole("menuitem", { name: "Relevância" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Data de publicação" })).toBeInTheDocument();
  });

  it("trocar a ordenação pelo dropdown re-executa a busca com a nova ordenação", async () => {
    const user = userEvent.setup();
    const searchChannel = vi.fn().mockResolvedValue(makeSearchResponse());
    render(<SearchView channelId={CHANNEL_ID} api={makeSearchApi({ searchChannel })} />);

    const input = screen.getByLabelText("Buscar");
    await user.type(input, "gato");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(searchChannel).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /Ordenar por/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Data de publicação" }));
    await waitFor(() => expect(searchChannel).toHaveBeenCalledTimes(2));

    expect(searchChannel.mock.calls[1]?.[0]).toEqual({
      q: "gato",
      channelId: CHANNEL_ID,
      sort: "publishedAt",
    });
  });

  it("mostra o erro da API como alerta", async () => {
    const user = userEvent.setup();
    const searchChannel = vi.fn().mockRejectedValue(new Error("Canal não encontrado"));
    render(<SearchView channelId={CHANNEL_ID} api={makeSearchApi({ searchChannel })} />);

    const input = screen.getByLabelText("Buscar");
    await user.type(input, "gato");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent("Canal não encontrado");
  });

  it("renderiza estado vazio quando o total de resultados é zero", async () => {
    const user = userEvent.setup();
    const searchChannel = vi
      .fn()
      .mockResolvedValue(makeSearchResponse({ hits: [], total: 0, query: "gato" }));
    render(<SearchView channelId={CHANNEL_ID} api={makeSearchApi({ searchChannel })} />);

    const input = screen.getByLabelText("Buscar");
    await user.type(input, "gato");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(
      await screen.findByText((content) => content.includes("Nenhum Documento encontrado para")),
    ).toHaveTextContent('Nenhum Documento encontrado para "gato"');
    expect(screen.queryByRole("link", { name: "Primeiro vídeo" })).not.toBeInTheDocument();
  });

  it("mostra 'buscando…' em fonte mono sob o input durante o fetch", async () => {
    let resolveSearch!: (value: SearchResponse) => void;
    const searchChannel = vi.fn().mockImplementation(
      () =>
        new Promise<SearchResponse>((resolve) => {
          resolveSearch = resolve;
        }),
    );
    render(<SearchView channelId={CHANNEL_ID} api={makeSearchApi({ searchChannel })} />);

    const user = userEvent.setup();
    const input = screen.getByLabelText("Buscar");
    await user.type(input, "gato");
    fireEvent.keyDown(input, { key: "Enter" });

    const indicator = await screen.findByText("buscando…");
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveClass("font-mono");

    // Resolve the in-flight fetch; the indicator must disappear.
    resolveSearch(makeSearchResponse({ hits: [], total: 0, query: "gato" }));
    await waitFor(() => expect(screen.queryByText("buscando…")).not.toBeInTheDocument());
  });

  it("Esc no input limpa o campo e os resultados exibidos", async () => {
    const user = userEvent.setup();
    const searchChannel = vi
      .fn()
      .mockResolvedValueOnce(makeSearchResponse({ hits: [makeVideoHit()], total: 1, query: "gato" }));
    render(<SearchView channelId={CHANNEL_ID} api={makeSearchApi({ searchChannel })} />);

    const input = screen.getByLabelText("Buscar");
    await user.type(input, "gato");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByRole("link", { name: "Primeiro vídeo" })).toBeInTheDocument();
    expect(input).toHaveValue("gato");

    fireEvent.keyDown(input, { key: "Escape" });

    expect(input).toHaveValue("");
    expect(screen.queryByRole("link", { name: "Primeiro vídeo" })).not.toBeInTheDocument();
    expect(searchChannel).toHaveBeenCalledTimes(1);
  });
});
