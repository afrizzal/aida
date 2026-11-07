// Run decision K155 (Codex diff critique round 2, finding 4): the server-side bound on an upload
// transaction whose COMMIT is still pending (src/lib/attachments/uncertain-commit.ts). On the
// real PostgreSQL 16 of the integration run:
//   - through Prisma, boundUploadCommitInTx sets the idle limit for the rest of the transaction
//     only;
//   - a session held idle inside the transaction past that limit is terminated by the server,
//     which aborts the transaction, so a COMMIT sent later cannot commit (the real constant);
//   - the stated limit: statement_timeout does not interrupt the commit work of a COMMIT (a
//     deferred trigger that outlasts it still commits), which is why it is not part of the bound;
//   - AIDA's migrated schema has no deferrable constraint and no deferred trigger, so a COMMIT of
//     an upload transaction runs no user code.
// The pg sessions create only temporary objects of their own session; nothing shared is written.
import pg from "pg";
import { describe, expect, it } from "vitest";
import {
  boundUploadCommitInTx,
  UNCERTAIN_COMMIT_CLEANUP_DELAY_MINUTES,
  UPLOAD_COMMIT_BOUND_SECONDS,
  UPLOAD_COMMIT_BOUND_SQL,
  UPLOAD_COMMIT_IDLE_TIMEOUT_SECONDS,
} from "@/lib/attachments/uncertain-commit";
import { prisma } from "@/lib/db";

const CASE_TIMEOUT = 120_000;

async function client(): Promise<{ c: pg.Client; errors: Error[] }> {
  const errors: Error[] = [];
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  c.on("error", (err) => errors.push(err));
  await c.connect();
  return { c, errors };
}

describe("K155: the server bounds an upload transaction once its last statement has run", () => {
  it("the stated bound is shorter than the queue delay", () => {
    expect(UPLOAD_COMMIT_BOUND_SECONDS).toBe(UPLOAD_COMMIT_IDLE_TIMEOUT_SECONDS);
    expect(UPLOAD_COMMIT_BOUND_SECONDS).toBeLessThan(UNCERTAIN_COMMIT_CLEANUP_DELAY_MINUTES * 60);
  });

  it("through Prisma: the idle limit holds inside the transaction and ends with it", async () => {
    const inside = await prisma.$transaction(async (tx) => {
      await boundUploadCommitInTx(tx);
      return tx.$queryRaw<{ idle: string }[]>`
        SELECT current_setting('idle_in_transaction_session_timeout') AS idle`;
    });
    expect(inside[0]?.idle).toBe(`${UPLOAD_COMMIT_IDLE_TIMEOUT_SECONDS}s`);
    const after = await prisma.$queryRaw<{ idle: string }[]>`
      SELECT current_setting('idle_in_transaction_session_timeout') AS idle`;
    expect(after[0]?.idle).not.toBe(`${UPLOAD_COMMIT_IDLE_TIMEOUT_SECONDS}s`);
  });

  it(
    "a session idle in the transaction past the idle limit is terminated by the server; the COMMIT sent afterwards does not commit",
    async () => {
      const held = await client();
      const watcher = await client();
      try {
        await held.c.query("BEGIN");
        await held.c.query("CREATE TEMP TABLE k155_idle (x int)");
        await held.c.query("INSERT INTO k155_idle VALUES (1)");
        const pid = (await held.c.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]
          ?.pid;
        await held.c.query(UPLOAD_COMMIT_BOUND_SQL);
        const start = Date.now();
        let gone = 0;
        while (Date.now() - start < (UPLOAD_COMMIT_IDLE_TIMEOUT_SECONDS + 15) * 1000) {
          const { rows } = await watcher.c.query<{ n: string }>(
            "SELECT count(*)::text AS n FROM pg_stat_activity WHERE pid = $1",
            [pid],
          );
          if (rows[0]?.n === "0") {
            gone = Date.now() - start;
            break;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
        expect(gone, "the server never ended the idle session").toBeGreaterThan(0);
        expect(gone).toBeGreaterThanOrEqual((UPLOAD_COMMIT_IDLE_TIMEOUT_SECONDS - 1) * 1000);
        await expect(held.c.query("COMMIT")).rejects.toThrow();
        const ended = held.errors.map((e) => (e as Error & { code?: string }).code);
        expect(ended.length === 0 || ended.includes("25P03")).toBe(true);
      } finally {
        await held.c.end().catch(() => undefined);
        await watcher.c.end();
      }
    },
    CASE_TIMEOUT,
  );

  it("the stated limit: statement_timeout does not interrupt the commit work of a COMMIT", async () => {
    const { c } = await client();
    try {
      await c.query("CREATE TEMP TABLE k155_commit (x int)");
      await c.query(
        "CREATE FUNCTION pg_temp.k155_slow() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(3); RETURN NULL; END $$",
      );
      await c.query(
        "CREATE CONSTRAINT TRIGGER k155_slow AFTER INSERT ON pg_temp.k155_commit DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pg_temp.k155_slow()",
      );
      await c.query("BEGIN");
      await c.query("INSERT INTO k155_commit VALUES (1)");
      await c.query("SELECT set_config('statement_timeout', '1s', true)");
      const start = Date.now();
      await c.query("COMMIT");
      expect(Date.now() - start).toBeGreaterThanOrEqual(2900);
      const left = await c.query<{ n: string }>("SELECT count(*)::text AS n FROM k155_commit");
      expect(left.rows[0]?.n).toBe("1");
    } finally {
      await c.end();
    }
  });

  it("AIDA's schema has no deferrable constraint and no deferred trigger, so its COMMIT runs no user code", async () => {
    const { c } = await client();
    try {
      const constraints = await c.query<{ name: string }>(
        `SELECT n.nspname || '.' || con.conname AS name FROM pg_constraint con
           JOIN pg_namespace n ON n.oid = con.connamespace
          WHERE con.condeferrable AND n.nspname NOT IN ('pg_catalog', 'information_schema')
            AND n.nspname NOT LIKE 'pg\\_temp%' AND n.nspname NOT LIKE 'pg\\_toast%'`,
      );
      const triggers = await c.query<{ name: string }>(
        `SELECT n.nspname || '.' || t.tgname AS name FROM pg_trigger t
           JOIN pg_class r ON r.oid = t.tgrelid JOIN pg_namespace n ON n.oid = r.relnamespace
          WHERE t.tgdeferrable AND NOT t.tgisinternal
            AND n.nspname NOT IN ('pg_catalog', 'information_schema')
            AND n.nspname NOT LIKE 'pg\\_temp%' AND n.nspname NOT LIKE 'pg\\_toast%'`,
      );
      expect(constraints.rows.map((r) => r.name)).toEqual([]);
      expect(triggers.rows.map((r) => r.name)).toEqual([]);
    } finally {
      await c.end();
    }
  });
});
