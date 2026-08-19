import { describe, expect, it } from "vitest";
import { YoutubeTranscriptFetcher } from "../src/transcripts.js";

function makeClient(response: {
  id: string;
  tracks: Array<{ language: string; transcript: Array<{ text: string; start: string; dur: string }> }>;
}) {
  return {
    ready: Promise.resolve(),
    getTranscript: async () => response,
  };
}

function makeClientThrowing(cause: Error): { ready: Promise<void>; getTranscript: () => Promise<never> } {
  return {
    ready: Promise.resolve(),
    getTranscript: async () => {
      throw cause;
    },
  };
}

describe("YoutubeTranscriptFetcher", () => {
  it('devolve { kind: "transcript" } com os Segmentos quando o serviço responde com track não-vazia', async () => {
    const fetcher = new YoutubeTranscriptFetcher(
      makeClient({
        id: "v1",
        tracks: [
          {
            language: "pt (auto-generated)",
            transcript: [
              { text: "primeiro trecho", start: "0", dur: "10.2" },
              { text: "trecho com deep-link", start: "142.5", dur: "8" },
            ],
          },
        ],
      }),
    );

    const result = await fetcher.fetchTranscript("v1");

    expect(result).toEqual({
      kind: "transcript",
      transcript: {
        videoId: "v1",
        segments: [
          { start: 0, duration: 10.2, text: "primeiro trecho" },
          { start: 142.5, duration: 8, text: "trecho com deep-link" },
        ],
      },
    });
  });

  it('devolve { kind: "absent" } quando o Vídeo não tem Transcrição (tracks vazias)', async () => {
    const fetcher = new YoutubeTranscriptFetcher(makeClient({ id: "v1", tracks: [] }));

    const result = await fetcher.fetchTranscript("v1");

    expect(result).toEqual({ kind: "absent" });
  });

  it('devolve { kind: "absent" } quando todas as tracks estão sem trechos', async () => {
    const fetcher = new YoutubeTranscriptFetcher(
      makeClient({ id: "v1", tracks: [{ language: "pt", transcript: [] }] }),
    );

    const result = await fetcher.fetchTranscript("v1");

    expect(result).toEqual({ kind: "absent" });
  });

  it('devolve { kind: "error", cause } carregando o Error original quando o serviço não-oficial falha (não re-embrulha em string)', async () => {
    const cause = new Error("vídeo exige autenticação extra");
    const fetcher = new YoutubeTranscriptFetcher(makeClientThrowing(cause));

    const result = await fetcher.fetchTranscript("v1");

    expect(result).toEqual({ kind: "error", cause });
    // O cause é o próprio Error original, não uma string re-embrulhada.
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.cause).toBe(cause);
    }
  });
});
