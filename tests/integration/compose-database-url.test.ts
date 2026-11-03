// Phase 9, D-12, D-13, AIDA-35 (compose-config clause): the DATABASE_URL that
// `docker compose config` resolves for migrate, app and worker.
//
// Renders docker-compose.yml with temporary env files and parses the JSON in memory. Starts no
// container and creates no Docker resource (rule J): `docker compose config` only reads files.
// Every password is synthetic, made here. Assertions pass only a service name and a boolean to
// `expect`, so a failure diff can never print a password or a URL containing one (D-13). The
// stack clause of AIDA-35 (the three services connect) is specified by plan 09-11 and not run here.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkDatabaseUrlConsistency, parseDatabaseUrl } from "../../src/lib/db-url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const COMPOSE_FILE = path.join(PROJECT_ROOT, "docker-compose.yml");
const GENERATOR = path.join(PROJECT_ROOT, "scripts", "database-url.sh");
const DB_SERVICES = ["app", "migrate", "worker"];

let tmpDir = "";

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aida-compose-dburl-"));
});

afterAll(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

const hex = () => randomBytes(8).toString("hex");
const reservedPassword = () => `${hex()}/@:#?${hex()}`;

/**
 * A minimal environment for the compose CLI: the shell environment wins over --env-file, so no
 * POSTGRES_*, AIDA_* or DATABASE_URL of the test process may reach compose.
 */
function cliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
  for (const key of ["HOME", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT", "TMPDIR"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

/** The single AIDA_DATABASE_URL value scripts/database-url.sh prints for these inputs. */
function generatedUrl(vars: { user: string; password: string; database: string }): string {
  const out = execFileSync("sh", [GENERATOR], {
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      POSTGRES_USER: vars.user,
      POSTGRES_PASSWORD: vars.password,
      POSTGRES_DB: vars.database,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = "AIDA_DATABASE_URL=";
  const line = out.trim();
  if (!line.startsWith(prefix)) throw new Error("generator printed an unexpected line");
  return line.slice(prefix.length);
}

type Environment = Record<string, string>;

let fileCounter = 0;

/** Writes a single-quoted env file (a `#` must not start a comment) and renders compose. */
async function render(vars: Record<string, string>): Promise<Record<string, Environment>> {
  const all: Record<string, string> = {
    BETTER_AUTH_SECRET: "test-only-secret",
    BETTER_AUTH_URL: "http://localhost",
    NEXT_PUBLIC_APP_URL: "http://localhost",
    ...vars,
  };
  for (const value of Object.values(all)) {
    if (value.includes("'")) throw new Error("env file values must not contain a single quote");
  }
  fileCounter += 1;
  const envFile = path.join(tmpDir, `case-${fileCounter}.env`);
  const body = Object.entries(all)
    .map(([key, value]) => `${key}='${value}'`)
    .join("\n");
  await fs.writeFile(envFile, `${body}\n`, { mode: 0o600 });
  let stdout: string;
  try {
    stdout = execFileSync(
      "docker",
      ["compose", "--env-file", envFile, "-f", COMPOSE_FILE, "config", "--format", "json"],
      {
        cwd: PROJECT_ROOT,
        env: cliEnv(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 16 * 1024 * 1024,
      },
    );
  } catch {
    // The error would carry compose's stdout and stderr; never rethrow it.
    throw new Error("docker compose config failed");
  }
  const config = JSON.parse(stdout) as {
    services: Record<string, { environment?: Record<string, string | null> }>;
  };
  const withUrl: Record<string, Environment> = {};
  for (const [name, service] of Object.entries(config.services)) {
    const env = service.environment ?? {};
    if (typeof env.DATABASE_URL !== "string") continue;
    withUrl[name] = Object.fromEntries(
      Object.entries(env).map(([key, value]) => [key, value ?? ""]),
    );
  }
  return withUrl;
}

function expectDbServices(services: Record<string, Environment>) {
  expect(Object.keys(services).sort().join(",")).toBe(DB_SERVICES.join(","));
}

describe("docker compose config resolves DATABASE_URL for migrate, app and worker (D-12, D-13)", () => {
  it("case A, reserved: a reserved-character password with the generated AIDA_DATABASE_URL", async () => {
    const vars = { user: "aida_user", password: reservedPassword(), database: "aida_db" };
    const services = await render({
      POSTGRES_USER: vars.user,
      POSTGRES_PASSWORD: vars.password,
      POSTGRES_DB: vars.database,
      AIDA_DATABASE_URL: generatedUrl(vars),
    });
    expectDbServices(services);
    for (const [name, env] of Object.entries(services)) {
      const parts = parseDatabaseUrl(env.DATABASE_URL ?? "");
      expect(
        parts !== null &&
          parts.user === vars.user &&
          parts.password === vars.password &&
          parts.database === vars.database &&
          parts.host === "db" &&
          parts.port === 5432,
        `${name}: decoded components equal the inputs`,
      ).toBe(true);
      expect(
        env.AIDA_EXPECT_DB_USER === vars.user &&
          env.AIDA_EXPECT_DB_PASSWORD === vars.password &&
          env.AIDA_EXPECT_DB_NAME === vars.database,
        `${name}: AIDA_EXPECT_DB_* present`,
      ).toBe(true);
      expect(checkDatabaseUrlConsistency(env).ok, `${name}: guard passes`).toBe(true);
    }
  });

  it("case B, url-safe fallback: a hex password and no AIDA_DATABASE_URL keep the pre-phase URL", async () => {
    const password = hex();
    const services = await render({ POSTGRES_PASSWORD: password });
    expectDbServices(services);
    for (const [name, env] of Object.entries(services)) {
      expect(
        env.DATABASE_URL === `postgresql://aida:${password}@db:5432/aida`,
        `${name}: pre-phase URL`,
      ).toBe(true);
      expect(checkDatabaseUrlConsistency(env).ok, `${name}: guard passes`).toBe(true);
    }
  });

  it("case C, mismatch: AIDA_DATABASE_URL from a different password fails on component password", async () => {
    const password = reservedPassword();
    const services = await render({
      POSTGRES_PASSWORD: password,
      AIDA_DATABASE_URL: generatedUrl({
        user: "aida",
        password: reservedPassword(),
        database: "aida",
      }),
    });
    expectDbServices(services);
    for (const [name, env] of Object.entries(services)) {
      const result = checkDatabaseUrlConsistency(env);
      expect(!result.ok && result.component === "password", `${name}: refused on password`).toBe(
        true,
      );
    }
  });

  it("case D, raw reserved refused: a reserved password without AIDA_DATABASE_URL is refused", async () => {
    const services = await render({ POSTGRES_PASSWORD: reservedPassword() });
    expectDbServices(services);
    for (const [name, env] of Object.entries(services)) {
      expect(checkDatabaseUrlConsistency(env).ok, `${name}: guard refuses`).toBe(false);
    }
  });

  it("case E, localhost DATABASE_URL ignored: a .env DATABASE_URL never reaches the services", async () => {
    const password = hex();
    const services = await render({
      POSTGRES_PASSWORD: password,
      DATABASE_URL: "postgresql://aida:aida@localhost:5432/aida",
    });
    expectDbServices(services);
    for (const [name, env] of Object.entries(services)) {
      const parts = parseDatabaseUrl(env.DATABASE_URL ?? "");
      expect(parts?.host === "db", `${name}: host is db`).toBe(true);
      expect(checkDatabaseUrlConsistency(env).ok, `${name}: guard passes`).toBe(true);
    }
  });
});
