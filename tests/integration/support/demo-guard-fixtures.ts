// Shared helpers for the tenant seed guard tests (plan 09-02): child processes and pg fixtures.
//
// Every child gets DATABASE_URL and every DEMO_* and ADMIN_* variable set explicitly, so a
// developer .env loaded by `dotenv/config` (prisma/seed.ts) cannot change a result: dotenv never
// overrides a variable that is already set, even to "".
//
// Output is kept in memory only. Password checks return booleans, so a failing assertion never
// prints a password.
//
// Node built-ins plus `pg` only; nothing under src/ is imported here.
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const TSX_CLI = path.join(PROJECT_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const DRIVER = path.join("tests", "integration", "support", "demo-driver.ts");
const SEED = path.join("prisma", "seed.ts");
const DRIVER_RESULT_PREFIX = "AIDA_DRIVER_RESULT ";

/** The documented default demo password (src/lib/demo/identities.ts, docs). Checked by a test. */
export const DOCUMENTED_DEMO_PASSWORD = "aida-demo-2026";

export interface GuardEnv {
  adminEmail: string;
  agentEmail: string;
  password: string;
}

/** Configured demo identities for one test, with a random password. */
export function makeGuardEnv(): GuardEnv {
  return {
    adminEmail: "owner@guard-demo.example.test",
    agentEmail: "agent@guard-demo.example.test",
    password: `pw-${randomBytes(12).toString("hex")}`,
  };
}

export function childEnv(
  url: string,
  guard: GuardEnv,
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: url,
    BETTER_AUTH_SECRET: `${randomUUID()}${randomUUID()}`,
    BETTER_AUTH_URL: "http://localhost:3000",
    DEMO_MODE: "",
    DEMO_ADMIN_EMAIL: guard.adminEmail,
    DEMO_ADMIN_PASSWORD: guard.password,
    DEMO_ADMIN_NAME: "Guard Admin",
    DEMO_AGENT_EMAIL: guard.agentEmail,
    ADMIN_EMAIL: "",
    ADMIN_PASSWORD: "",
    ADMIN_NAME: "",
    ...extra,
  };
}

export interface ChildRun {
  code: number | null;
  stdout: string;
  stderr: string;
  /** stdout and stderr together, for scans. */
  output: string;
}

export function runChild(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = 240_000,
): Promise<ChildRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`child ${args.join(" ")} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, output: `${stdout}\n${stderr}` });
    });
  });
}

export interface DriverResult {
  mode: string;
  outcome: string;
  stage?: string;
  message?: string;
}

export async function runDriver(
  url: string,
  guard: GuardEnv,
  args: string[],
  extra: Record<string, string> = {},
): Promise<ChildRun & { results: DriverResult[] }> {
  const run = await runChild(
    process.execPath,
    [TSX_CLI, DRIVER, ...args],
    childEnv(url, guard, extra),
  );
  const line = run.stdout
    .split("\n")
    .reverse()
    .find((l) => l.startsWith(DRIVER_RESULT_PREFIX));
  if (run.code !== 0 || !line) {
    throw new Error(
      `demo driver ${args.join(" ")} exited ${String(run.code)} without a result line\n${run.stderr.slice(-2000)}`,
    );
  }
  const parsed = JSON.parse(line.slice(DRIVER_RESULT_PREFIX.length)) as { results: DriverResult[] };
  return { ...run, results: parsed.results };
}

/** prisma/seed.ts through tsx, the command `pnpm db:seed` runs. */
export function runSeedScript(url: string, guard: GuardEnv): Promise<ChildRun> {
  return runChild(process.execPath, [TSX_CLI, SEED], childEnv(url, guard));
}

/** The real `pnpm db:seed`. */
export function runPnpmDbSeed(url: string, guard: GuardEnv): Promise<ChildRun> {
  return runChild("pnpm", ["--silent", "db:seed"], childEnv(url, guard));
}

/** Booleans only: does the output contain the configured password or the documented default? */
export function passwordLeaks(
  output: string,
  guard: GuardEnv,
): {
  configured: boolean;
  documentedDefault: boolean;
} {
  return {
    configured: output.includes(guard.password),
    documentedDefault: output.includes(DOCUMENTED_DEMO_PASSWORD),
  };
}

/** Matches advice to delete the database or its volumes. */
export const DELETE_ADVICE =
  /down -v|volume rm|dropdb|DROP DATABASE|migrate reset|delete (the|your) (database|volume)/i;

export async function withClient<T>(
  url: string,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** A user row as Better Auth stores it (no account, so no password). */
export async function insertUser(url: string, email: string): Promise<string> {
  const id = randomUUID();
  await withClient(url, (c) =>
    c.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, false, now(), now())`,
      [id, "Fixture User", email],
    ),
  );
  return id;
}

/** An organization row; the insert trigger adds its TicketState and TicketStateConfig rows. */
export async function insertOrganization(url: string, slug: string): Promise<string> {
  const id = randomUUID();
  await withClient(url, (c) =>
    c.query(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $2, $3, now())`, [
      id,
      `Fixture ${slug}`,
      slug,
    ]),
  );
  return id;
}

export async function insertMember(
  url: string,
  organizationId: string,
  userId: string,
  role: string,
): Promise<void> {
  await withClient(url, (c) =>
    c.query(
      `INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, $4, now())`,
      [randomUUID(), organizationId, userId, role],
    ),
  );
}

/** A non-demo workspace with zero tickets: an organization with its own owner. */
export async function insertForeignWorkspace(url: string): Promise<void> {
  const orgId = await insertOrganization(url, "acme");
  const userId = await insertUser(url, "owner@acme.example.test");
  await insertMember(url, orgId, userId, "owner");
}

export interface TenantState {
  organizations: { id: string; slug: string }[];
  userEmails: string[];
  markers: { organizationId: string; value: string }[];
  tickets: number;
  ticketStatesByOrg: Record<string, number>;
  ticketStateConfigs: number;
}

export async function tenantState(url: string): Promise<TenantState> {
  return withClient(url, async (c) => {
    const organizations = (
      await c.query<{ id: string; slug: string }>(`SELECT id, slug FROM organization ORDER BY id`)
    ).rows;
    const userEmails = (
      await c.query<{ email: string }>(`SELECT email FROM "user" ORDER BY email`)
    ).rows.map((r) => r.email);
    const markers = (
      await c.query<{ organizationId: string; value: string }>(
        `SELECT "organizationId", value FROM "Setting" WHERE key = 'demo:seed-complete'`,
      )
    ).rows;
    const tickets = Number(
      (await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM "Ticket"`)).rows[0].n,
    );
    const states = (
      await c.query<{ organizationId: string; n: string }>(
        `SELECT "organizationId", count(*)::text AS n FROM "TicketState" GROUP BY "organizationId"`,
      )
    ).rows;
    const ticketStateConfigs = Number(
      (await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM "TicketStateConfig"`)).rows[0]
        .n,
    );
    return {
      organizations,
      userEmails,
      markers,
      tickets,
      ticketStatesByOrg: Object.fromEntries(states.map((s) => [s.organizationId, Number(s.n)])),
      ticketStateConfigs,
    };
  });
}
