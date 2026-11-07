// Phase 9, Codex diff critique round 1, finding 6: the demo boot (src/lib/demo/bootstrap-demo.ts)
// and the seed CLI (prisma/seed.ts) log one fixed line naming only the error class and its code
// when the guarded seed throws, never the raw exception message, which can quote a password, a
// database URL or an email. The real bootstrap-demo.ts and seed.ts run; only runGuardedDemoSeed
// (which throws an error whose message holds a secret), the database client and process.exit are
// replaced.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "Pw-k6-s3cr3t-7f2a";

const h = vi.hoisted(() => ({ runGuardedDemoSeed: vi.fn() }));

vi.mock("dotenv/config", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: { $disconnect: vi.fn(async () => {}) } }));
vi.mock("@/lib/demo/tenant-guard", () => ({ runGuardedDemoSeed: h.runGuardedDemoSeed }));

/** A Prisma-like error: a class name, a code, and a message that quotes secrets. */
class FakeKnownRequestError extends Error {
  code = "P1000";
  constructor() {
    super(
      `Authentication failed for postgresql://aida:${SECRET}@db:5432/aida; DEMO_ADMIN_PASSWORD=${SECRET}`,
    );
    this.name = "PrismaClientKnownRequestError";
  }
}

type Logged = string[];
let logged: Logged;

function capture(): void {
  logged = [];
  const push = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "error").mockImplementation(push);
  vi.spyOn(console, "log").mockImplementation(push);
  vi.spyOn(console, "info").mockImplementation(push);
  vi.spyOn(console, "warn").mockImplementation(push);
}

beforeEach(() => {
  vi.resetModules();
  h.runGuardedDemoSeed.mockReset();
  capture();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("the demo boot logs a fixed line on a seed error (Codex finding 6)", () => {
  it("names the class and the code, never the message", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    h.runGuardedDemoSeed.mockRejectedValue(new FakeKnownRequestError());
    const { bootstrapDemoMode } = await import("@/lib/demo/bootstrap-demo");
    await expect(bootstrapDemoMode()).resolves.toBeUndefined();
    const failure = logged.filter((line) => line.includes("Demo seeding failed"));
    expect(failure).toEqual([
      "[demo] Demo seeding failed (PrismaClientKnownRequestError, P1000); nothing else is logged about it. The app starts without the demo.",
    ]);
    expect(logged.join("\n")).not.toContain(SECRET);
    expect(logged.join("\n")).not.toContain("postgresql://");
  });

  it("a non-Error rejection logs `unknown error`", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    h.runGuardedDemoSeed.mockRejectedValue(`raw ${SECRET}`);
    const { bootstrapDemoMode } = await import("@/lib/demo/bootstrap-demo");
    await bootstrapDemoMode();
    expect(logged.join("\n")).toContain("[demo] Demo seeding failed (unknown error)");
    expect(logged.join("\n")).not.toContain(SECRET);
  });
});

describe("the seed CLI logs a fixed line on a seed error (Codex finding 6)", () => {
  it("names the class and the code, never the message, and exits 1", async () => {
    h.runGuardedDemoSeed.mockRejectedValue(new FakeKnownRequestError());
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await import("../../prisma/seed");
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(exit).toHaveBeenCalledWith(1);
    const failure = logged.filter((line) => line.startsWith("[seed] Failed"));
    expect(failure).toEqual([
      "[seed] Failed (PrismaClientKnownRequestError, P1000); nothing else is logged about it.",
    ]);
    expect(logged.join("\n")).not.toContain(SECRET);
    expect(logged.join("\n")).not.toContain("postgresql://");
  });

  it("an error whose class name or code is not a plain token is reduced", async () => {
    const odd = new Error(`message ${SECRET}`);
    odd.name = `Bad name ${SECRET}`;
    (odd as Error & { code: string }).code = `x ${SECRET}`;
    h.runGuardedDemoSeed.mockRejectedValue(odd);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await import("../../prisma/seed");
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(logged.join("\n")).toContain("[seed] Failed (unknown error)");
    expect(logged.join("\n")).not.toContain(SECRET);
  });
});
