// K165 (a-WR-2, b-IN-4): a BETTER_AUTH_URL that is set but is not a bare http(s) origin (a path,
// /api/auth included, a query, a fragment, credentials, another scheme, garbage) stops the start of
// both processes that build links from it: the app (src/instrumentation.ts register()) and the
// worker (src/lib/worker/index.ts, the digest links). Each logs one `[boot]` line that names the
// variable and never its value, and exits 1 before it serves or connects to anything.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/bootstrap", () => ({ bootstrapFromEnv: vi.fn(async () => {}) }));
vi.mock("@/lib/demo/bootstrap-demo", () => ({ bootstrapDemoMode: vi.fn(async () => {}) }));

import { register } from "../../src/instrumentation";
import { bootstrapFromEnv } from "../../src/lib/bootstrap";

const ROOT = path.resolve(__dirname, "../..");
const PATH_VALUE = "https://boot-secret.example.test/aida";

class ExitSignal extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("RATE_LIMIT_PEPPER", "c2VjcmV0LXBlcHBlci1mb3ItdGVzdHMtb25seQ==");
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
    throw new ExitSignal(typeof code === "number" ? code : undefined);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.mocked(bootstrapFromEnv).mockClear();
});

function logged(): string {
  return errorSpy.mock.calls.map((call: unknown[]) => call.map(String).join(" ")).join("\n");
}

describe("the app refuses to start on a BETTER_AUTH_URL that is not a bare origin (K165)", () => {
  it.each([
    ["a sub-path", PATH_VALUE],
    ["the Better Auth base path", "https://boot-secret.example.test/api/auth"],
    ["a query string", "https://boot-secret.example.test/?x=1"],
    ["another scheme", "ftp://boot-secret.example.test"],
  ])("%s: register() logs one [boot] line naming the variable, not the value, and exits 1", async (_label, value) => {
    vi.stubEnv("BETTER_AUTH_URL", value);
    const err = await register().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExitSignal);
    expect((err as ExitSignal).code).toBe(1);
    expect(logged()).toContain("[boot]");
    expect(logged()).toContain("BETTER_AUTH_URL");
    expect(logged()).not.toContain("boot-secret");
    // Nothing after the check ran: no tenant bootstrap.
    expect(bootstrapFromEnv).not.toHaveBeenCalled();
  });

  it("a bare origin, with or without a trailing slash, starts normally", async () => {
    for (const value of ["http://localhost", "https://help.example.test/"]) {
      vi.stubEnv("BETTER_AUTH_URL", value);
      await expect(register()).resolves.toBeUndefined();
    }
    expect(bootstrapFromEnv).toHaveBeenCalledTimes(2);
    expect(logged()).not.toContain("BETTER_AUTH_URL");
  });
});

describe("the worker refuses to start on a BETTER_AUTH_URL that is not a bare origin (K165)", () => {
  it("logs one [boot] line naming the variable, not the value, and exits 1 before pg-boss connects", () => {
    const result = spawnSync(
      path.join(ROOT, "node_modules/.bin/tsx"),
      [path.join(ROOT, "src/lib/worker/index.ts")],
      {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 90_000,
        env: {
          NODE_ENV: "production",
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          // Port 1 on loopback: nothing listens, so a worker that got past the check would fail
          // with a connection error instead of the [boot] line.
          DATABASE_URL: "postgresql://boot:boot@127.0.0.1:1/boot",
          BETTER_AUTH_URL: PATH_VALUE,
        },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("[boot]");
    expect(result.stderr).toContain("BETTER_AUTH_URL");
    expect(result.stderr).not.toContain("boot-secret");
    expect(result.stderr).not.toContain("ECONNREFUSED");
    expect(result.stdout).not.toContain("[worker] started");
  }, 120_000);
});
