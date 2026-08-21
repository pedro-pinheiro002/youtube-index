import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChannelForm } from "../src/ChannelForm";

describe("ChannelForm", () => {
  it("renderiza o input de handle e o botão de ingestão (variant=hero)", () => {
    render(<ChannelForm onSubmit={() => {}} submitting={false} disabled={false} variant="hero" />);

    expect(screen.getByLabelText("@handle do Canal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ingerir Canal" })).toBeInTheDocument();
  });

  it("renderiza o input de handle e o botão de ingestão (variant=compact)", () => {
    render(<ChannelForm onSubmit={() => {}} submitting={false} disabled={false} variant="compact" />);

    expect(screen.getByLabelText("@handle do Canal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ingerir Canal" })).toBeInTheDocument();
  });

  it("dispara onSubmit com o handle digitado", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ChannelForm onSubmit={onSubmit} submitting={false} disabled={false} variant="hero" />);

    await user.type(screen.getByLabelText("@handle do Canal"), "@funkyblackcat");
    await user.click(screen.getByRole("button", { name: "Ingerir Canal" }));

    expect(onSubmit).toHaveBeenCalledWith("@funkyblackcat");
  });

  it("desabilita o form durante a submissão", () => {
    render(<ChannelForm onSubmit={() => {}} submitting={true} disabled={false} variant="hero" />);

    expect(screen.getByLabelText("@handle do Canal")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ingerindo..." })).toBeDisabled();
  });

  it("desabilita o form enquanto um Canal está sendo ingerido", () => {
    render(<ChannelForm onSubmit={() => {}} submitting={false} disabled={true} variant="compact" />);

    expect(screen.getByLabelText("@handle do Canal")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ingerir Canal" })).toBeDisabled();
  });

  it("não dispara onSubmit com handle vazio", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ChannelForm onSubmit={onSubmit} submitting={false} disabled={false} variant="hero" />);

    await user.click(screen.getByRole("button", { name: "Ingerir Canal" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("variant=hero mostra o heading youtube-index e a tagline", () => {
    render(<ChannelForm onSubmit={() => {}} submitting={false} disabled={false} variant="hero" />);

    expect(screen.getByRole("heading", { name: "youtube-index" })).toBeInTheDocument();
    expect(screen.getByText(/Busca local para o conteúdo/)).toBeInTheDocument();
  });

  it("variant=compact não mostra a tagline", () => {
    render(<ChannelForm onSubmit={() => {}} submitting={false} disabled={false} variant="compact" />);

    expect(screen.queryByText(/Busca local para o conteúdo/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "youtube-index" })).not.toBeInTheDocument();
  });

  it("renderiza a mensagem de erro com role=alert", () => {
    render(
      <ChannelForm
        onSubmit={() => {}}
        submitting={false}
        disabled={false}
        variant="hero"
        error="Canal não encontrado"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Canal não encontrado");
  });
});
