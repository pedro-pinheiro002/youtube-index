import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/schema.js";
import { SqliteIngestionQueue } from "../src/ingestion-queue.js";

const CHANNEL_ID = "UCY8iijN1AkyDCh1Z9akcqUA";

function makeQueue(now?: () => Date): SqliteIngestionQueue {
  const db = createDatabase(":memory:");
  db.prepare(
    "INSERT INTO channels (id, handle, title, status, created_at) VALUES (?, ?, ?, 'queued', ?)",
  ).run(CHANNEL_ID, "@funkyblackcat", "Funky Black Cat", new Date().toISOString());
  return new SqliteIngestionQueue(db, now);
}

describe("SqliteIngestionQueue", () => {
  describe("enqueue", () => {
    it("enfileira um job de Ingestão na Fila com status queued", () => {
      const queue = makeQueue();

      const job = queue.enqueue(CHANNEL_ID);

      expect(job).toMatchObject({ channelId: CHANNEL_ID, status: "queued" });
      expect(typeof job.id).toBe("number");
    });
  });

  describe("claimNext", () => {
    it("reivindica o job mais antigo em ordem FIFO e o marca como running", () => {
      const queue = makeQueue();
      queue.enqueue(CHANNEL_ID);
      queue.enqueue(CHANNEL_ID);

      const first = queue.claimNext();
      const second = queue.claimNext();

      expect(first).toMatchObject({ id: 1, channelId: CHANNEL_ID, status: "running" });
      expect(second).toMatchObject({ id: 2, channelId: CHANNEL_ID, status: "running" });
      expect(queue.listJobs(CHANNEL_ID).every((job) => job.status === "running")).toBe(true);
    });

    it("não reivindica um job que já está running", () => {
      const queue = makeQueue();
      queue.enqueue(CHANNEL_ID);

      queue.claimNext();

      expect(queue.claimNext()).toBeNull();
    });

    it("devolve null quando não há job na Fila", () => {
      const queue = makeQueue();

      expect(queue.claimNext()).toBeNull();
    });
  });

  describe("complete / fail", () => {
    it("marca o job como completed ou failed", () => {
      const queue = makeQueue();
      const ok = queue.enqueue(CHANNEL_ID);
      const bad = queue.enqueue(CHANNEL_ID);

      queue.complete(ok.id);
      queue.fail(bad.id);

      expect(queue.listJobs(CHANNEL_ID)).toEqual([
        expect.objectContaining({ id: ok.id, status: "completed" }),
        expect.objectContaining({ id: bad.id, status: "failed" }),
      ]);
    });
  });

  describe("listJobs", () => {
    it("lista apenas os jobs do Canal indicado", () => {
      const db = createDatabase(":memory:");
      const insertChannel = db.prepare(
        "INSERT INTO channels (id, handle, title, status, created_at) VALUES (?, ?, ?, 'queued', ?)",
      );
      insertChannel.run(CHANNEL_ID, "@funkyblackcat", "Funky Black Cat", new Date().toISOString());
      insertChannel.run("outro-canal", "@outro", "Outro Canal", new Date().toISOString());
      const queue = new SqliteIngestionQueue(db);
      queue.enqueue(CHANNEL_ID);
      queue.enqueue("outro-canal");

      const jobs = queue.listJobs(CHANNEL_ID);

      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({ channelId: CHANNEL_ID, status: "queued" });
    });
  });

  describe("recuperação de jobs órfãos", () => {
    it("reclama um job running criado há mais de 5 minutos e o devolve", () => {
      const start = new Date("2024-01-01T00:00:00Z");
      let current = start;
      const queue = makeQueue(() => current);

      queue.enqueue(CHANNEL_ID);
      const claimed = queue.claimNext();

      current = new Date("2024-01-01T00:06:00Z");
      const reclaimed = queue.claimNext();

      expect(reclaimed).toMatchObject({ id: claimed?.id, channelId: CHANNEL_ID, status: "running" });
      expect(queue.listJobs(CHANNEL_ID)).toEqual([
        expect.objectContaining({ id: claimed?.id, status: "running" }),
      ]);
    });

    it("não reclama um job running criado há menos de 5 minutos", () => {
      const start = new Date("2024-01-01T00:00:00Z");
      let current = start;
      const queue = makeQueue(() => current);

      queue.enqueue(CHANNEL_ID);
      queue.claimNext();

      current = new Date("2024-01-01T00:01:00Z");

      expect(queue.claimNext()).toBeNull();
    });
  });
});
