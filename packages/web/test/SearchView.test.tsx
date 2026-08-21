import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SearchView } from "../src/SearchView";
import {
  makeCommentHit,
  makeSearchApi,
  makeSearchResponse,
  makeSegmentHit,
  makeVideoHit,
} from "./helpers";

const CHANNEL_ID = "UCY8iijN1AkyDCh1Z9akcqUA";

describe("SearchView", () => {
  it("busca por palavra-chave em uma barra única e mostra resultados de todos os tipos", async () => {
    const user = userEvent.setup();
    const searchChannel = vi.fn().mockResolvedValue(
      makeSearchResponse({
        hits: [makeVideoHit(), makeCommentHit(), makeSegmentHit()],
        total: 3,
        query: "vídeo",
      }),
    );
    render(<SearchView channelId={CHANNEL_ID} api={makeSearchApi({ searchChannel })} />);

    await user.type(screen.getByLabelText("Buscar"), "vídeo");
    await user.click(screen.getByRole("button", { name: "Buscar" }));

    expect(await screen.findAllByRole("link", { name: "Primeiro vídeo" })).toHaveLength(3);
    expect(screen.getByText("Gato Funky · 02/01/2026 · 12 curtidas")).toBeInTheDocument();
    expect(screen.getByText("2:22 · 03/01/2026 · 1.234 visualizações · 56 curtidas")).toBeInTheDocument();
    expect(screen.getByText(/3 resultados/)).toBeInTheDocument();
    expect(searchChannel).toHaveBeenCalledWith({ q: "vídeo", channelId: CHANNEL_ID, sort: "relevance" });
  });

  it("filtrar por tipo re-executa a busca com o filtro", async () => {
    const user = userEvent.setup();
    const searchChannel = vi.fn().mockResolvedValue(makeSearchResponse());
    render(<SearchView channelId={CHANNEL_ID} api={makeSearchApi({ searchChannel })} />);

    await user.type(screen.getByLabelText("Buscar"), "gato");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(searchChannel).toHaveBeenCalledTimes(1));

    await user.selectOptions(screen.getByLabelText("Tipo"), "comment");
    await waitFor(() => expect(searchChannel).toHaveBeenCalledTimes(2));

    expect(searchChannel.mock.calls[1]?.[0]).toEqual({
      q: "gato",
      channelId: CHANNEL_ID,
      tipo: "comment",
      sort: "relevance",
    });
  });

  it("ordenar por data re-executa a busca com a ordenação", async () => {
    const user = userEvent.setup();
    const searchChannel = vi.fn().mockResolvedValue(makeSearchResponse());
    render(<SearchView channelId={CHANNEL_ID} api={makeSearchApi({ searchChannel })} />);

    await user.type(screen.getByLabelText("Buscar"), "gato");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(searchChannel).toHaveBeenCalledTimes(1));

    await user.selectOptions(screen.getByLabelText("Ordenar por"), "publishedAt");
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

    await user.type(screen.getByLabelText("Buscar"), "gato");
    await user.click(screen.getByRole("button", { name: "Buscar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Canal não encontrado");
  });

  it("desabilita o botão de Buscar com consulta vazia", () => {
    render(<SearchView channelId={CHANNEL_ID} api={makeSearchApi()} />);

    expect(screen.getByRole("button", { name: "Buscar" })).toBeDisabled();
  });

  it("Esc no input limpa o campo e os resultados exibidos", async () => {
    const user = userEvent.setup();
    const searchChannel = vi
      .fn()
      .mockResolvedValueOnce(makeSearchResponse({ hits: [makeVideoHit()], total: 1, query: "gato" }));
    render(<SearchView channelId={CHANNEL_ID} api={makeSearchApi({ searchChannel })} />);

    const input = screen.getByLabelText("Buscar");
    await user.type(input, "gato");
    await user.click(screen.getByRole("button", { name: "Buscar" }));

    expect(await screen.findByRole("link", { name: "Primeiro vídeo" })).toBeInTheDocument();
    expect(input).toHaveValue("gato");

    fireEvent.keyDown(input, { key: "Escape" });

    expect(input).toHaveValue("");
    expect(screen.queryByRole("link", { name: "Primeiro vídeo" })).not.toBeInTheDocument();
    expect(searchChannel).toHaveBeenCalledTimes(1);
  });
});
