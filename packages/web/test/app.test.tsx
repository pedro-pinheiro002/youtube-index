import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import {
  makeApi,
  makeChannel,
  makeCommentHit,
  makeSearchApi,
  makeSearchResponse,
  makeSegmentHit,
  makeVideoHit,
} from "./helpers";

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
      expect(screen.getByText(/— Ingerindo/)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(/— Concluído/)).toBeInTheDocument();
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

    const searchInput = await screen.findByLabelText("Buscar");
    await user.type(searchInput, "gato");
    fireEvent.keyDown(searchInput, { key: "Enter" });

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

  it("coluna centralizada tem largura máxima ~768px e padding lateral responsivo px-4 sm:px-6 md:px-8", () => {
    render(<App api={makeApi()} />);

    const main = screen.getByRole("main");
    expect(main).toHaveClass("max-w-3xl");
    expect(main).toHaveClass("mx-auto");
    expect(main).toHaveClass("px-4");
    expect(main).toHaveClass("sm:px-6");
    expect(main).toHaveClass("md:px-8");
  });

  it("tela de resultados usa violeta em no máximo 3 categorias: botões primários, focus ring, <em> background", async () => {
    const user = userEvent.setup();
    const api = makeApi({ createChannel: async () => makeChannel("completed") });
    const searchChannel = vi.fn().mockResolvedValue(
      makeSearchResponse({
        hits: [makeVideoHit(), makeCommentHit(), makeSegmentHit()],
        total: 3,
        query: "gato",
      }),
    );
    const searchApi = makeSearchApi({ searchChannel });

    const { container } = render(
      <App api={api} searchApi={searchApi} pollIntervalMs={50} />,
    );

    await user.type(screen.getByLabelText("@handle do Canal"), "@funkyblackcat");
    await user.click(screen.getByRole("button", { name: "Ingerir Canal" }));

    const searchInput = await screen.findByLabelText("Buscar");
    await user.type(searchInput, "gato");
    fireEvent.keyDown(searchInput, { key: "Enter" });

    // Aguarda os resultados renderizarem antes de coletar as classes de violeta.
    await waitFor(() => {
      expect(searchChannel).toHaveBeenCalled();
    });
    await screen.findAllByRole("link", { name: "Primeiro vídeo" });

    // Regra de design: violeta é usado em no máximo 3 categorias:
    //   1. botões primários (bg-primary)
    //   2. focus rings (focus-visible:ring-ring)
    //   3. destaque do <em> nos resultados da Busca (bg-violet-500/15)
    // Adicionar uma 4ª categoria (ex.: outro tom bg-violet-*) violaria a
    // regra e quebraria esta asserção.
    const violetPatterns = new Set<string>();
    container.querySelectorAll<HTMLElement>("*").forEach((el) => {
      const cls = el.className;
      if (typeof cls !== "string") return;
      cls.split(/\s+/).forEach((token) => {
        if (
          token === "bg-primary" ||
          token.includes("violet") ||
          token.includes("ring-ring")
        ) {
          violetPatterns.add(token);
        }
      });
    });

    expect(violetPatterns.size).toBeLessThanOrEqual(3);
    expect(violetPatterns.has("bg-primary")).toBe(true);
    expect(violetPatterns.has("bg-violet-500/15")).toBe(true);
    expect(violetPatterns.has("focus-visible:ring-ring")).toBe(true);
  });
});
