import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/schema.js";
import {
  PostgresIngestionQueue,
  SqliteIngestionQueue,
  applyPgSchema,
  closePgPool,
  createPgPool,
  type IngestionQueue,
  type Pool,
} from "@youtube-index/domain";

interface QueueHandle {
  queue: IngestionQueue;
  channelId: string;
  otherChannelId: string;
}

interface QueueBackend {
  name: string;
  makeHandle: (now?: () => Date) => Promise<QueueHandle>;
}

// Pool compartilhado por todos os testes Postgres. Cada teste recebe
// ids únicos via `testNamespace()` para isolar dados entre testes
// paralelos que compartilham o mesmo banco. Os canais são deletados
// no `afterAll` via cascade.
const POSTGRES_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/youtube_index";
let postgresPool: Pool;
const createdChannelIds: string[] = [];

beforeAll(async () => {
  postgresPool = createPgPool({ databaseUrl: POSTGRES_URL });
  await applyPgSchema(postgresPool);
});

afterAll(async () => {
  if (createdChannelIds.length > 0) {
    await postgresPool.query("DELETE FROM channels WHERE id = ANY($1)", [createdChannelIds]);
  }
  await closePgPool(postgresPool);
});

// O backend Postgres compartilha um único banco entre todos os testes do
// arquivo. Sem `afterEach`, jobs órfãos de testes anteriores (canais
// que ainda não foram limpos ou dados de runs passados) ficam na fila
// e o `claimNext` FIFO os pega antes dos jobs do teste atual. O cascade
// do `DELETE FROM channels` varre `ingestion_jobs` junto.
afterEach(async () => {
  if (createdChannelIds.length > 0) {
    await postgresPool.query("DELETE FROM channels WHERE id = ANY($1)", [createdChannelIds]);
    createdChannelIds.length = 0;
  }
});

let counter = 0;
function testNamespace(suffix: string): string {
  counter += 1;
  return `UC_Q_${process.pid}_${counter}_${suffix}`;
}

const sqliteBackend: QueueBackend = {
  name: "SqliteIngestionQueue",
  async makeHandle(now) {
    const channelId = "UCY8iijN1AkyDCh1Z9akcqUA";
    const otherChannelId = "outro-canal";
    const db = createDatabase(":memory:");
    db.prepare(
      "INSERT INTO channels (id, handle, title, status, created_at) VALUES (?, ?, ?, 'queued', ?)",
    ).run(channelId, "@funkyblackcat", "Funky Black Cat", new Date().toISOString());
    db.prepare(
      "INSERT INTO channels (id, handle, title, status, created_at) VALUES (?, ?, ?, 'queued', ?)",
    ).run(otherChannelId, "@outro", "Outro Canal", new Date().toISOString());
    return {
      queue: new SqliteIngestionQueue(db, now),
      channelId,
      otherChannelId,
    };
  },
};

const postgresBackend: QueueBackend = {
  name: "PostgresIngestionQueue",
  async makeHandle(now) {
    const channelId = testNamespace("queue");
    const otherChannelId = testNamespace("outro");
    createdChannelIds.push(channelId, otherChannelId);
    await postgresPool.query(
      `INSERT INTO channels (id, handle, title, status)
       VALUES ($1, $2, $3, 'queued')
       ON CONFLICT (id) DO NOTHING`,
      [channelId, "@funkyblackcat", "Funky Black Cat"],
    );
    await postgresPool.query(
      `INSERT INTO channels (id, handle, title, status)
       VALUES ($1, $2, $3, 'queued')
       ON CONFLICT (id) DO NOTHING`,
      [otherChannelId, "@outro", "Outro Canal"],
    );
    return {
      queue: new PostgresIngestionQueue(postgresPool, now),
      channelId,
      otherChannelId,
    };
  },
};

const backends: QueueBackend[] = [sqliteBackend, postgresBackend];

describe.each(backends)("$name", ({ makeHandle }) => {
  describe("enqueue", () => {
    it("enfileira um job de Ingestão na Fila com status queued", async () => {
      const { queue, channelId } = await makeHandle();

      const job = await queue.enqueue(channelId);

      expect(job).toMatchObject({ channelId, status: "queued" });
      expect(typeof job.id).toBe("number");
    });
  });

  describe("claimNext", () => {
    it("reivindica o job mais antigo em ordem FIFO e o marca como running", async () => {
      const { queue, channelId } = await makeHandle();
      const firstEnqueued = await queue.enqueue(channelId);
      const secondEnqueued = await queue.enqueue(channelId);

      const first = await queue.claimNext();
      const second = await queue.claimNext();

      expect(first).toMatchObject({ id: firstEnqueued.id, channelId, status: "running" });
      expect(second).toMatchObject({ id: secondEnqueued.id, channelId, status: "running" });
      expect((first?.id ?? 0) < (second?.id ?? 0)).toBe(true);
      const jobs = await queue.listJobs(channelId);
      expect(jobs.every((job) => job.status === "running")).toBe(true);
    });

    it("não reivindica um job que já está running", async () => {
      const { queue, channelId } = await makeHandle();
      await queue.enqueue(channelId);

      await queue.claimNext();

      expect(await queue.claimNext()).toBeNull();
    });

    it("devolve null quando não há job na Fila", async () => {
      const { queue } = await makeHandle();

      expect(await queue.claimNext()).toBeNull();
    });
  });

  describe("complete / fail", () => {
    it("marca o job como completed ou failed", async () => {
      const { queue, channelId } = await makeHandle();
      const ok = await queue.enqueue(channelId);
      const bad = await queue.enqueue(channelId);

      await queue.complete(ok.id);
      await queue.fail(bad.id);

      expect(await queue.listJobs(channelId)).toEqual([
        expect.objectContaining({ id: ok.id, status: "completed" }),
        expect.objectContaining({ id: bad.id, status: "failed" }),
      ]);
    });
  });

  describe("listJobs", () => {
    it("lista apenas os jobs do Canal indicado", async () => {
      const { queue, channelId, otherChannelId } = await makeHandle();
      await queue.enqueue(channelId);
      await queue.enqueue(otherChannelId);

      const jobs = await queue.listJobs(channelId);

      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({ channelId, status: "queued" });
    });
  });

  describe("recuperação de jobs órfãos", () => {
    it("reclama um job running criado há mais de 5 minutos e o devolve", async () => {
      const start = new Date("2024-01-01T00:00:00Z");
      let current = start;
      const { queue, channelId } = await makeHandle(() => current);

      await queue.enqueue(channelId);
      const claimed = await queue.claimNext();

      current = new Date("2024-01-01T00:06:00Z");
      const reclaimed = await queue.claimNext();

      expect(reclaimed).toMatchObject({ id: claimed?.id, channelId, status: "running" });
      expect(await queue.listJobs(channelId)).toEqual([
        expect.objectContaining({ id: claimed?.id, status: "running" }),
      ]);
    });

    it("não reclama um job running criado há menos de 5 minutos", async () => {
      const start = new Date("2024-01-01T00:00:00Z");
      let current = start;
      const { queue, channelId } = await makeHandle(() => current);

      await queue.enqueue(channelId);
      await queue.claimNext();

      current = new Date("2024-01-01T00:01:00Z");

      expect(await queue.claimNext()).toBeNull();
    });
  });
});