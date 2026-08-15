import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useChannel } from "../src/useChannel";
import { makeChannel, makeApi } from "./helpers";

describe("useChannel", () => {
  it("submit cria o Canal via createChannel e o guarda no estado", async () => {
    const createChannel = vi.fn().mockResolvedValue(makeChannel("queued"));
    const getChannel = vi.fn();
    const api = makeApi({ createChannel, getChannel });
    const { result } = renderHook(() => useChannel({ api }));

    await act(async () => {
      await result.current.submit("@funkyblackcat");
    });

    expect(createChannel).toHaveBeenCalledWith("@funkyblackcat");
    expect(result.current.channel).toMatchObject({ id: "UCY8iijN1AkyDCh1Z9akcqUA", status: "queued" });
    expect(result.current.error).toBeNull();
    expect(result.current.submitting).toBe(false);
  });

  it("submit guarda a mensagem de erro quando createChannel falha", async () => {
    const createChannel = vi.fn().mockRejectedValue(new Error("Canal não encontrado"));
    const api = makeApi({ createChannel });
    const { result } = renderHook(() => useChannel({ api }));

    await act(async () => {
      await result.current.submit("@nao-existe");
    });

    expect(result.current.error).toBe("Canal não encontrado");
    expect(result.current.channel).toBeNull();
    expect(result.current.submitting).toBe(false);
  });

  it("faz polling de getChannel enquanto o Canal não termina e para ao completar", async () => {
    const getChannel = vi
      .fn()
      .mockResolvedValueOnce(makeChannel("ingesting"))
      .mockResolvedValueOnce(makeChannel("ingesting"))
      .mockResolvedValueOnce(makeChannel("completed"));
    const api = makeApi({ getChannel });
    const { result } = renderHook(() => useChannel({ api, pollIntervalMs: 10 }));

    await act(async () => {
      await result.current.submit("@funkyblackcat");
    });

    await waitFor(() => expect(result.current.channel?.status).toBe("completed"));
    expect(getChannel).toHaveBeenCalledTimes(3);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(getChannel).toHaveBeenCalledTimes(3);
  });

  it("faz polling de getChannel enquanto o Canal não termina e para ao falhar", async () => {
    const getChannel = vi.fn().mockResolvedValueOnce(makeChannel("ingesting")).mockResolvedValueOnce(makeChannel("failed"));
    const api = makeApi({ getChannel });
    const { result } = renderHook(() => useChannel({ api, pollIntervalMs: 10 }));

    await act(async () => {
      await result.current.submit("@funkyblackcat");
    });

    await waitFor(() => expect(result.current.channel?.status).toBe("failed"));
    expect(getChannel).toHaveBeenCalledTimes(2);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(getChannel).toHaveBeenCalledTimes(2);
  });

  it("continua o polling mesmo quando getChannel falha transitoriamente", async () => {
    const getChannel = vi
      .fn()
      .mockResolvedValueOnce(makeChannel("ingesting"))
      .mockRejectedValueOnce(new Error("rede caiu"))
      .mockResolvedValueOnce(makeChannel("completed"));
    const api = makeApi({ getChannel });
    const { result } = renderHook(() => useChannel({ api, pollIntervalMs: 10 }));

    await act(async () => {
      await result.current.submit("@funkyblackcat");
    });

    await waitFor(() => expect(result.current.channel?.status).toBe("completed"));
    expect(getChannel).toHaveBeenCalledTimes(3);
  });

  it("para o polling e mostra erro após falhas consecutivas de getChannel", async () => {
    const getChannel = vi.fn().mockRejectedValue(new Error("API fora do ar"));
    const api = makeApi({ getChannel });
    const { result } = renderHook(() => useChannel({ api, pollIntervalMs: 10 }));

    await act(async () => {
      await result.current.submit("@funkyblackcat");
    });

    await waitFor(() => expect(result.current.error).toBe("Falha ao consultar o progresso do Canal"));
    expect(getChannel).toHaveBeenCalledTimes(3);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(getChannel).toHaveBeenCalledTimes(3);
  });
});