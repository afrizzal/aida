// Phase 9 fix batch F7 (Codex diff critique round 3, finding 4): the membership-repair and
// recovery commands of docs/OPERATIONS.md, taken from the checked-in text, run against a real
// PostgreSQL 16 server. The server is this run's rule-J integration database container (labels
// aida.test=1 and aida.test.run=<runId>, found through integrationDatabaseContainerId); each
// case works only in scratch databases named ops_r34_<hex> that it creates and drops itself.
// `docker compose exec -T db` becomes `docker exec -i -e POSTGRES_DB=<scratch> <container>`, so
// the inner `sh -c` sees POSTGRES_USER from the container and POSTGRES_DB as the scratch database,
// exactly as it would see the db service's settings. Placeholders such as <organizationId> are
// replaced with the case's values. No other container, database or volume is touched.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integrationDatabaseContainerId } from "./support/backup-runner";

const DOC = readFileSync(path.resolve(__dirname, "../../docs/OPERATIONS.md"), "utf8");

/** Every ```bash block, de-indented by its fence's indentation (blocks inside list items). */
function bashBlocks(text: string): string[] {
  const blocks: string[] = [];
  let indent: string | null = null;
  let lines: string[] = [];
  for (const line of text.split("\n")) {
    if (indent === null) {
      const open = /^(\s*)```bash\s*$/.exec(line);
      if (open) {
        indent = open[1] as string;
        lines = [];
      }
      continue;
    }
    if (line.trim() === "```") {
      blocks.push(lines.join("\n"));
      indent = null;
      continue;
    }
    lines.push(line.startsWith(indent) ? line.slice(indent.length) : line.trimStart());
  }
  return blocks;
}

/** The one `docker compose exec -T db` command (with its heredoc) whose text holds `marker`. */
function command(marker: string): string {
  const found: string[] = [];
  for (const block of bashBlocks(DOC)) {
    const lines = block.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] as string;
      if (!line.startsWith("docker compose exec -T db ")) continue;
      const cmd = [line];
      const heredoc = /<<'([A-Z]+)'/.exec(line);
      if (heredoc) {
        for (let j = i + 1; j < lines.length; j += 1) {
          cmd.push(lines[j] as string);
          if (lines[j] === heredoc[1]) break;
        }
      }
      const text = cmd.join("\n");
      if (text.includes(marker)) found.push(text);
    }
  }
  if (found.length !== 1)
    throw new Error(`expected one command with ${marker}, found ${found.length}`);
  return found[0] as string;
}

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

function sh(script: string, input = ""): Promise<Result> {
  return new Promise((resolve) => {
    const child = execFile(
      "/bin/bash",
      ["-c", script],
      { timeout: 60_000 },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
        resolve({ code, stdout, stderr });
      },
    );
    child.stdin?.end(input);
  });
}

let container = "";
const scratch: string[] = [];

/** SQL as the server's superuser on the maintenance database (setup and checks only). */
async function admin(sql: string, db = "postgres"): Promise<string> {
  const r = await sh(
    `docker exec -i ${container} sh -c 'psql -U "$POSTGRES_USER" -d ${db} -X -q -t -A -v ON_ERROR_STOP=1'`,
    sql,
  );
  if (r.code !== 0) throw new Error(`admin SQL failed: ${r.stderr}`);
  return r.stdout.trim();
}

async function scratchDatabase(): Promise<string> {
  const name = `ops_r34_${randomBytes(4).toString("hex")}`;
  scratch.push(name, `${name}_before_rollback`, `${name}_failed_restore`);
  await admin(`CREATE DATABASE ${name};`);
  return name;
}

/** Runs a runbook command as written, with POSTGRES_DB set to the scratch database. */
function runbook(cmd: string, db: string, values: Record<string, string> = {}): Promise<Result> {
  let text = cmd.replace(
    /^docker compose exec -T db /,
    `docker exec -i -e POSTGRES_DB=${db} ${container} `,
  );
  for (const [placeholder, value] of Object.entries(values)) {
    text = text.split(`<${placeholder}>`).join(value);
  }
  return sh(text);
}

beforeAll(async () => {
  container = await integrationDatabaseContainerId();
});

afterAll(async () => {
  for (const name of scratch) await admin(`DROP DATABASE IF EXISTS ${name};`);
}, 120_000);

describe("Codex r3-4: the runbook's psql commands run as written", () => {
  for (const suffix of ["_before_rollback", "_failed_restore"]) {
    it(`the ${suffix} rename keeps the database under the new name and creates an empty one`, async () => {
      const db = await scratchDatabase();
      await admin("CREATE TABLE kept_rows (x int); INSERT INTO kept_rows VALUES (7);", db);
      const r = await runbook(command(suffix), db);
      expect(r.code, r.stderr).toBe(0);
      expect(await admin(`SELECT x FROM kept_rows;`, `${db}${suffix}`)).toBe("7");
      expect(await admin(`SELECT count(*) FROM pg_tables WHERE schemaname = 'public';`, db)).toBe(
        "0",
      );
    });
  }

  it("the rename changes nothing while a session is connected: psql stops before CREATE DATABASE", async () => {
    const db = await scratchDatabase();
    await admin("CREATE TABLE kept_rows (x int);", db);
    const holder = sh(
      `docker exec -i ${container} sh -c 'psql -U "$POSTGRES_USER" -d ${db} -X -q -c "SELECT pg_sleep(8)"'`,
    );
    const until = Date.now() + 10_000;
    while ((await admin(`SELECT count(*) FROM pg_stat_activity WHERE datname = '${db}';`)) === "0") {
      if (Date.now() > until) throw new Error("the holding session never connected");
      await new Promise((r) => setTimeout(r, 100));
    }
    const r = await runbook(command("_before_rollback"), db);
    await holder;
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("is being accessed by other users");
    expect(
      await admin(`SELECT count(*) FROM pg_database WHERE datname = '${db}_before_rollback';`),
    ).toBe("0");
    expect(await admin(`SELECT count(*) FROM pg_tables WHERE tablename = 'kept_rows';`, db)).toBe(
      "1",
    );
  });

  it("the duplicate-member query lists a user with two rows in one workspace, and only that one", async () => {
    const db = await scratchDatabase();
    await admin(
      `CREATE TABLE member (id text PRIMARY KEY, "organizationId" text, "userId" text, role text);
       INSERT INTO member VALUES ('m1', 'o1', 'u1', 'owner'), ('m2', 'o1', 'u1', 'member'), ('m3', 'o1', 'u2', 'admin');`,
      db,
    );
    const r = await runbook(command("HAVING count(*) > 1"), db);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/o1\s*\|\s*u1\s*\|\s*\{owner,member\}/);
    expect(r.stdout).not.toContain("u2");
  });

  it("the repair gives every row of that user in that workspace the one role, in one transaction, and removes no row", async () => {
    const db = await scratchDatabase();
    await admin(
      `CREATE TABLE member (id text PRIMARY KEY, "organizationId" text, "userId" text, role text);
       INSERT INTO member VALUES ('m1', 'o1', 'u1', 'owner'), ('m2', 'o1', 'u1', 'member'), ('m3', 'o2', 'u1', 'admin');`,
      db,
    );
    const r = await runbook(command("UPDATE member SET role"), db, {
      organizationId: "o1",
      userId: "u1",
      role: "owner",
    });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain("COMMIT");
    expect(
      await admin(`SELECT string_agg(id || '=' || role, ',' ORDER BY id) FROM member;`, db),
    ).toBe("m1=owner,m2=owner,m3=admin");
  });
});
