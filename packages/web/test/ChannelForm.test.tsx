import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChannelForm } from "../src/ChannelForm";

describe("ChannelForm", () => {
  it("renderiza o input de handle e o botão de ingestão", () => {
    render(<ChannelForm onSubmit={() => {}} submitting={false} disabled={false} />);

    expect(screen.getByLabelText("@handle do Canal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ingerir canal" })).toBeInTheDocument();
  });

  it("dispara onSubmit com o handle digitado", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ChannelForm onSubmit={onSubmit} submitting={false} disabled={false} />);

    await user.type(screen.getByLabelText("@handle do Canal"), "@funkyblackcat");
    await user.click(screen.getByRole("button", { name: "Ingerir canal" }));

    expect(onSubmit).toHaveBeenCalledWith("@funkyblackcat");
  });

  it("desabilita o form durante a submissão", () => {
    render(<ChannelForm onSubmit={() => {}} submitting={true} disabled={false} />);

    expect(screen.getByLabelText("@handle do Canal")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ingerindo..." })).toBeDisabled();
  });

  it("desabilita o form enquanto um Canal está sendo ingerido", () => {
    render(<ChannelForm onSubmit={() => {}} submitting={false} disabled={true} />);

    expect(screen.getByLabelText("@handle do Canal")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ingerir canal" })).toBeDisabled();
  });

  it("não dispara onSubmit com handle vazio", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ChannelForm onSubmit={onSubmit} submitting={false} disabled={false} />);

    await user.click(screen.getByRole("button", { name: "Ingerir canal" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});