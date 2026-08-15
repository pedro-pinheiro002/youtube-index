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

  describe("claimNextJob", () => {
    it("reivindica o job mais antigo em ordem FIFO e o marca como running", () => {
      const ledger = makeLedger();
      const channel = ledger.createChannel({
        channelId: "UCY8iijN1AkyDCh1Z9akcqUA",
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      ledger.enqueueJob(channel.id);
      ledger.enqueueJob(channel.id);

      const first = ledger.claimNextJob();
      const second = ledger.claimNextJob();

      expect(first).toMatchObject({ id: 1, channelId: channel.id, status: "running" });
      expect(second).toMatchObject({ id: 2, channelId: channel.id, status: "running" });
      expect(ledger.listJobs(channel.id).every((j) => j.status === "running")).toBe(true);
    });

    it("não reivindica um job que já está running", () => {
      const ledger = makeLedger();
      const channel = ledger.createChannel({
        channelId: "UCY8iijN1AkyDCh1Z9akcqUA",
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      ledger.enqueueJob(channel.id);

      ledger.claimNextJob();

      expect(ledger.claimNextJob()).toBeNull();
    });

    it("devolve null quando não há job na Fila", () => {
      const ledger = makeLedger();

      expect(ledger.claimNextJob()).toBeNull();
    });
  });

  describe("completeJob / failJob", () => {
    it("marca o job como completed ou failed", () => {
      const ledger = makeLedger();
      const channel = ledger.createChannel({
        channelId: "UCY8iijN1AkyDCh1Z9akcqUA",
        handle: "@funkyblackcat",
        title: "Funky Black Cat",
      });
      const ok = ledger.enqueueJob(channel.id);
      const bad = ledger.enqueueJob(channel.id);

      ledger.completeJob(ok.id);
      ledger.failJob(bad.id);

      expect(ledger.listJobs(channel.id)).toEqual([
        expect.objectContaining({ id: ok.id, status: "completed" }),
        expect.objectContaining({ id: bad.id, status: "failed" }),
      ]);
    });
  });
});