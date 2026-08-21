import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { ChannelWithPhases } from "../src/types";
import { makeApi, makeChannel, makeSearchApi } from "./helpers";

describe("App", () => {
  it("renderiza o título do aplicativo", () => {
    render(<App api={makeApi()} />);

    expect(screen.getByRole("heading", { name: "youtube-index" })).toBeInTheDocument();
  });

  it("informa o @handle, dispara a Ingestão e mostra o progresso por polling", async () => {
    const user = userEvent.setup();
    const createChannel = vi.fn().mockResolvedValue(makeChannel("ingesting"));
    const getChannel = vi
      .fn()
      .mockResolvedValueOnce(makeChannel("ingesting"))
      .mockResolvedValueOnce(makeChannel("completed"));
    const api = makeApi({ createChannel, getChannel });

    render(<App api={api} pollIntervalMs={50} />);

    await user.type(screen.getByLabelText("@handle do Canal"), "@funkyblackcat");
    await user.click(screen.getByRole("button", { name: "Ingerir Canal" }));

    expect(createChannel).toHaveBeenCalledWith("@funkyblackcat");

    await waitFor(() => {
      expect(screen.getByText(/status: Ingerindo/)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(/status: Concluído/)).toBeInTheDocument();
    });

    expect(getChannel).toHaveBeenCalledTimes(2);
  });

  it("mostra a mensagem de erro quando o Canal não é encontrado", async () => {
    const user = userEvent.setup();
    const api = makeApi({
      createChannel: async () => {
        throw new Error("Canal não encontrado para handle '@nao-existe'");
      },
    });

    render(<App api={api} pollIntervalMs={50} />);

    await user.type(screen.getByLabelText("@handle do Canal"), "@nao-existe");
    await user.click(screen.getByRole("button", { name: "Ingerir Canal" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Canal não encontrado para handle '@nao-existe'",
    );
  });

  it("mostra a Busca do Canal depois que o handle é informado", async () => {
    const user = userEvent.setup();
    const api = makeApi({ createChannel: async () => makeChannel("completed") });
    const searchApi = makeSearchApi();

    render(<App api={api} searchApi={searchApi} pollIntervalMs={50} />);

    await user.type(screen.getByLabelText("@handle do Canal"), "@funkyblackcat");
    await user.click(screen.getByRole("button", { name: "Ingerir Canal" }));

    expect(await screen.findByRole("heading", { name: "Busca" })).toBeInTheDocument();
    expect(screen.getByLabelText("Buscar")).toBeInTheDocument();
  });

  it("busca por palavra-chave no canal recém-criado", async () => {
    const user = userEvent.setup();
    const api = makeApi({ createChannel: async () => makeChannel("completed") });
    const searchChannel = vi.fn().mockResolvedValue({
      hits: [],
      total: 0,
      query: "gato",
    });
    const searchApi = makeSearchApi({ searchChannel });

    render(<App api={api} searchApi={searchApi} pollIntervalMs={50} />);

    await user.type(screen.getByLabelText("@handle do Canal"), "@funkyblackcat");
    await user.click(screen.getByRole("button", { name: "Ingerir Canal" }));

    await user.type(await screen.findByLabelText("Buscar"), "gato");
    await user.click(screen.getByRole("button", { name: "Buscar" }));

    await waitFor(() => {
      expect(searchChannel).toHaveBeenCalledWith({
        q: "gato",
        channelId: "UCY8iijN1AkyDCh1Z9akcqUA",
        sort: "relevance",
      });
    });
  });

  it("hero vazio: estado sem Canal exibe heading, tagline e formulário prominente", () => {
    render(<App api={makeApi()} />);

    expect(screen.getByRole("heading", { name: "youtube-index" })).toBeInTheDocument();
    expect(screen.getByText(/Busca local para o conteúdo/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ingerir Canal" })).toBeInTheDocument();
  });

  it("toggle de tema aplica a classe dark ou light em <html>", async () => {
    const user = userEvent.setup();
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add("dark");

    render(<App api={makeApi()} />);

    await user.click(screen.getByRole("button", { name: "alternar tema" }));

    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("youtube-index:theme")).toBe("light");

    await user.click(screen.getByRole("button", { name: "alternar tema" }));

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(localStorage.getItem("youtube-index:theme")).toBe("dark");
  });

  it("document.title reflete o estado: sem Canal vs. com Canal carregado", async () => {
    const user = userEvent.setup();
    document.title = "outro título";
    const api = makeApi({ createChannel: async () => makeChannel("completed") });

    render(<App api={api} pollIntervalMs={50} />);
    expect(document.title).toBe("youtube-index");

    await user.type(screen.getByLabelText("@handle do Canal"), "@funkyblackcat");
    await user.click(screen.getByRole("button", { name: "Ingerir Canal" }));

    await waitFor(() => expect(document.title).toBe("youtube-index — @funkyblackcat"));
  });
});