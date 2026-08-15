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

function makeClientThrowing(): { ready: Promise<void>; getTranscript: () => Promise<never> } {
  return {
    ready: Promise.resolve(),
    getTranscript: async () => {
      throw new Error("vídeo exige autenticação extra");
    },
  };
}

describe("YoutubeTranscriptFetcher", () => {
  it("converte a resposta do serviço não-oficial em Segmentos com start/duration numéricos", async () => {
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

    const transcript = await fetcher.fetchTranscript("v1");

    expect(transcript).toEqual({
      videoId: "v1",
      segments: [
        { start: 0, duration: 10.2, text: "primeiro trecho" },
        { start: 142.5, duration: 8, text: "trecho com deep-link" },
      ],
    });
  });

  it("devolve null quando o Vídeo não tem Transcrição (tracks vazias)", async () => {
    const fetcher = new YoutubeTranscriptFetcher(makeClient({ id: "v1", tracks: [] }));

    const transcript = await fetcher.fetchTranscript("v1");

    expect(transcript).toBeNull();
  });

  it("devolve null quando todas as tracks estão sem trechos", async () => {
    const fetcher = new YoutubeTranscriptFetcher(
      makeClient({ id: "v1", tracks: [{ language: "pt", transcript: [] }] }),
    );

    const transcript = await fetcher.fetchTranscript("v1");

    expect(transcript).toBeNull();
  });

  it("devolve null quando o serviço não-oficial falha (não derruba o pipeline)", async () => {
    const fetcher = new YoutubeTranscriptFetcher(makeClientThrowing());

    const transcript = await fetcher.fetchTranscript("v1");

    expect(transcript).toBeNull();
  });
});