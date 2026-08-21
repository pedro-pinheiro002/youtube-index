import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "../src/useMediaQuery";

type Listener = (event: MediaQueryListEvent) => void;

interface MediaQueryStub {
  matches: boolean;
  media: string;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  dispatch: (nextMatches: boolean) => void;
}

function installMatchMedia(): {
  setMatch: (query: string, matches: boolean) => void;
  installQuery: (query: string, initialMatches: boolean) => MediaQueryStub;
} {
  const stubs = new Map<string, MediaQueryStub>();
  const matchMedia = vi.fn((query: string): MediaQueryList => {
    const existing = stubs.get(query);
    if (existing) {
      return existing as unknown as MediaQueryList;
    }
    const listeners = new Set<Listener>();
    const stub: MediaQueryStub = {
      matches: false,
      media: query,
      addEventListener: vi.fn((event: string, listener: Listener) => {
        if (event === "change") {
          listeners.add(listener);
        }
      }),
      removeEventListener: vi.fn((event: string, listener: Listener) => {
        if (event === "change") {
          listeners.delete(listener);
        }
      }),
      dispatch: (nextMatches: boolean) => {
        stub.matches = nextMatches;
        const event = { matches: nextMatches, media: query } as MediaQueryListEvent;
        listeners.forEach((listener) => listener(event));
      },
    };
    stubs.set(query, stub);
    return stub as unknown as MediaQueryList;
  });
  window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

  return {
    setMatch: (query: string, matches: boolean) => {
      const stub = stubs.get(query);
      if (!stub) {
        throw new Error(`No matchMedia stub registered for query: ${query}`);
      }
      stub.dispatch(matches);
    },
    installQuery: (query: string, initialMatches: boolean) => {
      const stub = stubs.get(query);
      if (stub) {
        stub.matches = initialMatches;
        return stub;
      }
      const fresh = matchMedia(query);
      // Cast through `unknown` because MediaQueryListStub is structural and
      // only narrows to MediaQueryList for the getSnapshot / subscribe contract.
      (fresh as unknown as MediaQueryStub).matches = initialMatches;
      return stubs.get(query)!;
    },
  };
}

afterEach(() => {
  // jsdom does not ship matchMedia; reset to undefined so each test installs
  // a fresh stub set.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).matchMedia;
});

describe("useMediaQuery", () => {
  it("retorna o estado atual de matchMedia para a query informada", () => {
    const mq = installMatchMedia();
    mq.installQuery("(min-width: 640px)", true);

    const { result } = renderHook(() => useMediaQuery("(min-width: 640px)"));

    expect(result.current).toBe(true);
  });

  it("atualiza o estado quando a media query muda", () => {
    const mq = installMatchMedia();
    mq.installQuery("(min-width: 640px)", false);

    const { result } = renderHook(() => useMediaQuery("(min-width: 640px)"));
    expect(result.current).toBe(false);

    act(() => {
      mq.setMatch("(min-width: 640px)", true);
    });

    expect(result.current).toBe(true);
  });

  it("remove o listener ao desmontar", () => {
    const mq = installMatchMedia();
    const stub = mq.installQuery("(min-width: 640px)", true);

    const { unmount } = renderHook(() => useMediaQuery("(min-width: 640px)"));
    expect(stub.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));

    unmount();

    expect(stub.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("retorna false quando matchMedia não está disponível", () => {
    // window.matchMedia is deleted in afterEach; the lazy initializer also
    // falls back to false.
    const { result } = renderHook(() => useMediaQuery("(min-width: 640px)"));
    expect(result.current).toBe(false);
  });
});
