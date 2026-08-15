import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/schema.js";
import { SqliteLedger } from "../src/ledger.js";

function makeLedger() {
  const db = createDatabase(":memory:");
  return new SqliteLedger(db);
}

describe("SqliteLedger", () => {
  describe("createChannel", () => {
    it("cria um Canal com status queued e as três Fases em pending", () => {
      const ledger = makeLedger();

      const channel = ledger.createChannel({
        channelId: "UCY8iijN1AkyDCh1Z9akcqUA",
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });

      expect(channel).toMatchObject({
        id: "UCY8iijN1AkyDCh1Z9akcqUA",
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
        status: "queued",
      });
      expect(channel.phases).toMatchObject({
        videos: { phase: "videos", status: "pending", done: 0, total: null },
        comments: { phase: "comments", status: "pending", done: 0, total: null },
        transcripts: { phase: "transcripts", status: "pending", done: 0, total: null },
      });
    });

    it("é idempotente quando o mesmo channelId já existe", () => {
      const ledger = makeLedger();
      const input = {
        channelId: "UCY8iijN1AkyDCh1Z9akcqUA",
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      };

      ledger.createChannel(input);
      const again = ledger.createChannel(input);

      expect(again.id).toBe(input.channelId);
    });
  });

  describe("getChannel", () => {
    it("devolve o Canal criado com status e progresso por Fase", () => {
      const ledger = makeLedger();
      const input = {
        channelId: "UCY8iijN1AkyDCh1Z9akcqUA",
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      };
      ledger.createChannel(input);

      const channel = ledger.getChannel(input.channelId);

      expect(channel).not.toBeNull();
      expect(channel?.id).toBe(input.channelId);
      expect(channel?.status).toBe("queued");
      expect(Object.keys(channel?.phases ?? {})).toEqual(["videos", "comments", "transcripts"]);
    });

    it("devolve null para um channelId desconhecido", () => {
      const ledger = makeLedger();

      expect(ledger.getChannel("desconhecido")).toBeNull();
    });
  });

  describe("enqueueJob", () => {
    it("enfileira um job de Ingestão na Fila com status queued", () => {
      const ledger = makeLedger();
      const channel = ledger.createChannel({
        channelId: "UCY8iijN1AkyDCh1Z9akcqUA",
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });

      const job = ledger.enqueueJob(channel.id);

      expect(job).toMatchObject({
        channelId: channel.id,
        status: "queued",
      });
      expect(typeof job.id).toBe("number");
    });

    it("lista os jobs enfileirados de um Canal", () => {
      const ledger = makeLedger();
      const channel = ledger.createChannel({
        channelId: "UCY8iijN1AkyDCh1Z9akcqUA",
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });

      ledger.enqueueJob(channel.id);
      ledger.enqueueJob(channel.id);

      const jobs = ledger.listJobs(channel.id);
      expect(jobs).toHaveLength(2);
      expect(jobs[0]).toMatchObject({ channelId: channel.id, status: "queued" });
    });
  });
});