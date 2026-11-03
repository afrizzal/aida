import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertDatabaseUrlConsistent,
  checkDatabaseUrlConsistency,
  DatabaseUrlMismatchError,
  encodeDatabaseUrl,
  encodeUrlComponent,
  parseDatabaseUrl,
} from "@/lib/db-url";

/**
 * Phase 9, D-12, D-13, AIDA-35: the database URL encoding, the generator script and the boot
 * guard. Every password here is synthetic, made in the test. Assertions on secret-bearing values
 * compare booleans, so a failure diff never prints a password or a URL containing one.
 */
const ROOT = path.resolve(__dirname, "../..");
const GENERATOR = path.join(ROOT, "scripts", "database-url.sh");

const hex = () => randomBytes(6).toString("hex");

const VECTORS: { name: string; password: string }[] = [
  { name: "reserved characters inside hex", password: `${hex()}/@:#?${hex()}` },
  { name: "only reserved characters", password: "/@:#?[]!$&'()*+,;=" },
  { name: "a literal percent sign", password: `${hex()}%25%${hex()}%` },
  { name: "non-ASCII", password: `${hex()}-é-日本-🔑` },
  { name: "URL-safe hex", password: hex() },
];

const base = { host: "db", port: 5432 };

function generator(env: Record<string, string>) {
  return spawnSync("sh", [GENERATOR], {
    env: { NODE_ENV: "test", PATH: process.env.PATH ?? "/usr/bin:/bin", ...env },
    encoding: "utf8",
  });
}

describe("encodeUrlComponent", () => {
  it("keeps only RFC 3986 unreserved characters and writes uppercase hex per UTF-8 byte", () => {
    expect(encodeUrlComponent("Az09-._~")).toBe("Az09-._~");
    expect(encodeUrlComponent("/@:#?")).toBe("%2F%40%3A%23%3F");
    expect(encodeUrlComponent("%")).toBe("%25");
    expect(encodeUrlComponent("é")).toBe("%C3%A9");
    expect(encodeUrlComponent(" ")).toBe("%20");
  });
});

describe("encodeDatabaseUrl and parseDatabaseUrl round-trip", () => {
  for (const { name, password } of VECTORS) {
    it(`round-trips ${name}`, () => {
      const parts = { user: "aida", password, database: "aida", ...base };
      const parsed = parseDatabaseUrl(encodeDatabaseUrl(parts));
      expect(parsed !== null).toBe(true);
      expect(parsed?.password === password).toBe(true);
      expect(parsed?.user).toBe("aida");
      expect(parsed?.database).toBe("aida");
      expect(parsed?.host).toBe("db");
      expect(parsed?.port).toBe(5432);
    });
  }

  it("encodes user and database name as well (D-12(5))", () => {
    const parts = { user: "us@er:x", password: hex(), database: "d/b#?", ...base };
    const url = encodeDatabaseUrl(parts);
    expect(url).toContain("us%40er%3Ax");
    expect(url).toContain("/d%2Fb%23%3F");
    const parsed = parseDatabaseUrl(url);
    expect(parsed?.user).toBe("us@er:x");
    expect(parsed?.database).toBe("d/b#?");
  });

  it("returns null for strings that are not a postgres URL", () => {
    expect(parseDatabaseUrl("not a url")).toBeNull();
    expect(parseDatabaseUrl("mysql://aida:x@db:3306/aida")).toBeNull();
    expect(parseDatabaseUrl("postgresql://aida:%E0%A4%A@db:5432/aida")).toBeNull();
    expect(parseDatabaseUrl("postgres://aida:x@db/aida")?.port).toBe(5432);
  });
});

describe("checkDatabaseUrlConsistency", () => {
  const password = `${hex()}/@:#?`;
  const consistent = {
    DATABASE_URL: encodeDatabaseUrl({ user: "aida", password, database: "aida", ...base }),
    AIDA_EXPECT_DB_USER: "aida",
    AIDA_EXPECT_DB_PASSWORD: password,
    AIDA_EXPECT_DB_NAME: "aida",
  };

  it("passes a consistent environment", () => {
    expect(checkDatabaseUrlConsistency(consistent)).toEqual({ ok: true });
  });

  it("is inactive without DATABASE_URL or AIDA_EXPECT_DB_PASSWORD (next dev, E2E)", () => {
    expect(checkDatabaseUrlConsistency({ ...consistent, AIDA_EXPECT_DB_PASSWORD: "" })).toEqual({
      ok: true,
    });
    expect(
      checkDatabaseUrlConsistency({ ...consistent, AIDA_EXPECT_DB_PASSWORD: undefined }),
    ).toEqual({ ok: true });
    expect(checkDatabaseUrlConsistency({ ...consistent, DATABASE_URL: "" })).toEqual({ ok: true });
    expect(
      checkDatabaseUrlConsistency({ DATABASE_URL: "postgresql://aida:aida@localhost:5432/aida" }),
    ).toEqual({ ok: true });
  });

  it("compares user and database only when their expected value is set", () => {
    expect(
      checkDatabaseUrlConsistency({
        ...consistent,
        AIDA_EXPECT_DB_USER: "",
        AIDA_EXPECT_DB_NAME: undefined,
      }),
    ).toEqual({ ok: true });
  });

  it("reports each mismatching component by name, in the order url, user, password, database", () => {
    const cases: [Record<string, string>, string][] = [
      [{ DATABASE_URL: "postgresql://aida:a/b@:#@db:5432/aida" }, "url"],
      [{ AIDA_EXPECT_DB_USER: "other" }, "user"],
      [{ AIDA_EXPECT_DB_PASSWORD: `${password}x` }, "password"],
      [{ AIDA_EXPECT_DB_NAME: "other" }, "database"],
      // Several mismatches: the first in the fixed order wins.
      [{ AIDA_EXPECT_DB_USER: "other", AIDA_EXPECT_DB_NAME: "other" }, "user"],
      [{ AIDA_EXPECT_DB_PASSWORD: hex(), AIDA_EXPECT_DB_NAME: "other" }, "password"],
    ];
    for (const [override, component] of cases) {
      expect(checkDatabaseUrlConsistency({ ...consistent, ...override })).toEqual({
        ok: false,
        component,
      });
    }
  });

  it("refuses a raw reserved password in the URL (the pre-phase compose form)", () => {
    const raw = `postgresql://aida:${password}@db:5432/aida`;
    expect(checkDatabaseUrlConsistency({ ...consistent, DATABASE_URL: raw }).ok).toBe(false);
  });
});

describe("assertDatabaseUrlConsistent", () => {
  it("throws a fixed message per component that never contains a value", () => {
    const password = `${hex()}/@:#?`;
    const other = `${hex()}/@:#?`;
    const env = {
      DATABASE_URL: encodeDatabaseUrl({ user: "aida", password, database: "aida", ...base }),
      AIDA_EXPECT_DB_USER: "aida",
      AIDA_EXPECT_DB_PASSWORD: other,
      AIDA_EXPECT_DB_NAME: "aida",
    };
    let caught: unknown;
    try {
      assertDatabaseUrlConsistent(env);
    } catch (error) {
      caught = error;
    }
    expect(caught instanceof DatabaseUrlMismatchError).toBe(true);
    const err = caught as DatabaseUrlMismatchError;
    expect(err.component).toBe("password");
    expect(err.message).toBe(
      "DATABASE_URL password does not match POSTGRES_PASSWORD; set AIDA_DATABASE_URL with scripts/database-url.sh",
    );
    for (const secret of [password, other, encodeURIComponent(password), env.DATABASE_URL]) {
      expect(err.message.includes(secret)).toBe(false);
      expect(String(err.stack).includes(secret)).toBe(false);
    }

    expect(() => assertDatabaseUrlConsistent({ ...env, DATABASE_URL: "%%%" })).toThrow(
      "DATABASE_URL could not be parsed; set AIDA_DATABASE_URL with scripts/database-url.sh",
    );
    expect(() =>
      assertDatabaseUrlConsistent({ ...env, AIDA_EXPECT_DB_PASSWORD: password }),
    ).not.toThrow();
  });
});

describe("scripts/database-url.sh", () => {
  for (const { name, password } of VECTORS) {
    it(`prints one AIDA_DATABASE_URL line that parses back for ${name}`, () => {
      const result = generator({
        POSTGRES_USER: "us er@x",
        POSTGRES_PASSWORD: password,
        POSTGRES_DB: "d#b",
      });
      expect(result.status).toBe(0);
      const lines = result.stdout.split("\n").filter((line) => line !== "");
      expect(lines.length).toBe(1);
      const line = lines[0] ?? "";
      expect(line.startsWith("AIDA_DATABASE_URL=postgresql://")).toBe(true);
      const url = line.slice("AIDA_DATABASE_URL=".length);
      // Byte-identical to the TypeScript encoder.
      expect(
        url ===
          encodeDatabaseUrl({ user: "us er@x", password, database: "d#b", host: "db", port: 5432 }),
      ).toBe(true);
      const parsed = parseDatabaseUrl(url);
      expect(parsed?.password === password).toBe(true);
      expect(parsed?.user).toBe("us er@x");
      expect(parsed?.database).toBe("d#b");
      expect(parsed?.host).toBe("db");
      expect(parsed?.port).toBe(5432);
    });
  }

  it("defaults user and database to aida", () => {
    const password = hex();
    const result = generator({ POSTGRES_PASSWORD: password });
    expect(result.status).toBe(0);
    expect(result.stdout === `AIDA_DATABASE_URL=postgresql://aida:${password}@db:5432/aida\n`).toBe(
      true,
    );
  });

  for (const [label, env] of [
    ["empty", { POSTGRES_PASSWORD: "" }],
    ["unset", {}],
  ] as const) {
    it(`exits 2 with nothing on stdout when POSTGRES_PASSWORD is ${label}`, () => {
      const result = generator({ ...env });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("POSTGRES_PASSWORD is empty");
      expect(result.stderr.includes("postgresql://")).toBe(false);
    });
  }
});

describe("scripts/check-database-url.ts (the migrate pre-step, D-12(4))", () => {
  const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

  function guard(env: Record<string, string>) {
    return spawnSync(process.execPath, [TSX, "scripts/check-database-url.ts"], {
      cwd: ROOT,
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: process.env.HOME ?? "",
        ...env,
      },
      encoding: "utf8",
      timeout: 60_000,
    });
  }

  const password = `${hex()}/@:#?`;
  const url = encodeDatabaseUrl({ user: "aida", password, database: "aida", ...base });
  const expected = { AIDA_EXPECT_DB_USER: "aida", AIDA_EXPECT_DB_NAME: "aida" };

  it("exits 1 on a mismatch and prints neither value", () => {
    const other = `${hex()}/@:#?`;
    const result = guard({ DATABASE_URL: url, ...expected, AIDA_EXPECT_DB_PASSWORD: other });
    expect(result.status).toBe(1);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(
      output.includes("[migrate] DATABASE_URL password does not match POSTGRES_PASSWORD"),
    ).toBe(true);
    for (const secret of [password, other, encodeURIComponent(password), url]) {
      expect(output.includes(secret)).toBe(false);
    }
    expect(output.includes("postgresql://")).toBe(false);
  });

  it("exits 0 and prints nothing on a matching environment", () => {
    const result = guard({ DATABASE_URL: url, ...expected, AIDA_EXPECT_DB_PASSWORD: password });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("exits 0 (inactive) without AIDA_EXPECT_DB_PASSWORD", () => {
    const result = guard({ DATABASE_URL: "postgresql://aida:a/b@:#@db:5432/aida", ...expected });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });
});
