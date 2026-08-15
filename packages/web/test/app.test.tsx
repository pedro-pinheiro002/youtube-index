import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { ChannelWithPhases } from "../src/types";
import { makeApi, makeChannel } from "./helpers";

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
    await user.click(screen.getByRole("button", { name: "Ingerir canal" }));

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
    await user.click(screen.getByRole("button", { name: "Ingerir canal" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Canal não encontrado para handle '@nao-existe'",
    );
  });
});