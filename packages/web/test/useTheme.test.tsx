import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTheme } from "../src/useTheme";

const STORAGE_KEY = "youtube-index:theme";

function resetDom(): void {
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add("dark");
  localStorage.clear();
}

afterEach(() => {
  resetDom();
});

describe("useTheme", () => {
  it("lê a preferência do localStorage quando ela está armazenada", () => {
    resetDom();
    localStorage.setItem(STORAGE_KEY, "light");
    const matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
    window.matchMedia = matchMedia;

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("cai para prefers-color-scheme: light quando o localStorage está vazio", () => {
    resetDom();
    const matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: () => {}, removeEventListener: () => {} });
    window.matchMedia = matchMedia;

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("light");
    expect(matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: light)");
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("cai para prefers-color-scheme: dark quando o localStorage está vazio", () => {
    resetDom();
    const matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
    window.matchMedia = matchMedia;

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("toggle persiste a escolha e aplica a classe correspondente em <html>", () => {
    resetDom();
    const matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
    window.matchMedia = matchMedia;

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("dark");

    act(() => result.current.toggle());

    expect(result.current.theme).toBe("light");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    act(() => result.current.toggle());

    expect(result.current.theme).toBe("dark");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("ignora valores inválidos no localStorage e usa prefers-color-scheme", () => {
    resetDom();
    localStorage.setItem(STORAGE_KEY, "fúcsia");
    const matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: () => {}, removeEventListener: () => {} });
    window.matchMedia = matchMedia;

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });
});
