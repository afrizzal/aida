import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import { prisma } from "@/lib/db";
import { resetHealthStateForTests } from "@/lib/health/health-check";

// Mock the DB module so no real Postgres connection is needed
vi.mock("@/lib/db", () => ({
  prisma: {
    systemSetting: {
      findUnique: vi.fn(),
    },
  },
}));

const HEARTBEAT = {
  id: "test-id",
  key: "heartbeat:lastRunAt",
  value: "2026-01-01T00:00:00.000Z",
  updatedAt: new Date(),
};

// No X-Forwarded-For: in unit tests no platform fills it, so this lands in the shared bucket.
function req(xff?: string): Request {
  return new Request("http://localhost/api/health", {
    headers: xff ? { "x-forwarded-for": xff } : {},
  });
}

// d-IN-d2: every case starts from TRUSTED_PROXY_HOPS blank (the shipped default), never from
// the shell's value; cases that need another count set it themselves.
beforeEach(() => {
  vi.stubEnv("TRUSTED_PROXY_HOPS", "");
  resetHealthStateForTests();
  vi.mocked(prisma.systemSetting.findUnique).mockReset();
  vi.mocked(prisma.systemSetting.findUnique).mockResolvedValue(HEARTBEAT);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("GET /api/health", () => {
  it("returns 200 with db:connected and worker.lastRunAt when DB is healthy", async () => {
    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.db).toBe("connected");
    expect(body.worker.lastRunAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns 503 with db:unreachable when DB throws", async () => {
    vi.mocked(prisma.systemSetting.findUnique).mockRejectedValueOnce(new Error("DB unreachable"));

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.db).toBe("unreachable");
  });
});

describe("GET /api/health throttle (D-20)", () => {
  it("flood: the 60th request from one identity gets 200, the 61st 429 with Retry-After; others unaffected", async () => {
    vi.useFakeTimers();
    for (let i = 1; i <= 60; i++) {
      expect((await GET(req("203.0.113.40"))).status).toBe(200);
    }
    const denied = await GET(req("203.0.113.40"));
    expect(denied.status).toBe(429);
    expect(await denied.json()).toEqual({ error: "rate_limited" });
    const retryAfter = Number(denied.headers.get("Retry-After"));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect((await GET(req())).status).toBe(200);
  });

  // d-IN-d3: the flood is above the shared limit (200 a minute against 120), so the case fails if
  // a flood from one address ever spends the no-identity bucket, for example a global cap that
  // charges every request to it. At 100 a minute (the old case) such a cap still passed.
  it("a flood from one address above the shared limit (200/min) never spends the no-identity bucket: one no-identity GET every 10 s for 10 minutes stays 200", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T00:00:00.000Z"));
    const probeStatuses: number[] = [];
    let flooderDenied = 0;
    let flooded = 0;
    for (let tick = 0; tick < 60; tick++) {
      // 200 requests per minute from the flooder, spread across the six 10-second ticks.
      const floodThisTick = tick % 6 < 2 ? 34 : 33;
      for (let i = 0; i < floodThisTick; i++) {
        flooded++;
        if ((await GET(req("203.0.113.41"))).status === 429) flooderDenied++;
      }
      probeStatuses.push((await GET(req())).status);
      vi.advanceTimersByTime(10_000);
    }
    expect(flooded).toBe(2000);
    expect(probeStatuses).toHaveLength(60);
    expect(probeStatuses.every((s) => s === 200)).toBe(true);
    // The flooder is held to its own 60 a minute: 140 of every 200 are refused.
    expect(flooderDenied).toBe(1400);
  });

  it("shared bucket: 120 no-identity GETs in one window get 200, the 121st 429; loopback is not exempt", async () => {
    vi.useFakeTimers();
    for (let i = 1; i <= 120; i++) {
      expect((await GET(req())).status).toBe(200);
    }
    expect((await GET(req())).status).toBe(429);
  });

  it("loopback is throttled like any identity", async () => {
    vi.useFakeTimers();
    for (let i = 1; i <= 60; i++) await GET(req("127.0.0.1"));
    expect((await GET(req("127.0.0.1"))).status).toBe(429);
  });

  it("never logs the throttle key", async () => {
    vi.useFakeTimers();
    const spies = (["log", "info", "warn", "error"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    for (let i = 1; i <= 61; i++) await GET(req("203.0.113.42"));
    for (const spy of spies) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain("203.0.113.42");
      spy.mockRestore();
    }
  });
});

describe("GET /api/health cache and single-flight (D-20)", () => {
  const findUnique = () => vi.mocked(prisma.systemSetting.findUnique);

  it("serves two GETs within 3 s from one DB read; after 3 s plus 1 ms reads again", async () => {
    vi.useFakeTimers();
    await GET(req());
    await GET(req());
    expect(findUnique()).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3001);
    await GET(req());
    expect(findUnique()).toHaveBeenCalledTimes(2);
  });

  it("DB down then up: 503 is cached for the TTL, then the next read returns 200", async () => {
    vi.useFakeTimers();
    findUnique().mockRejectedValueOnce(new Error("DB unreachable"));
    expect((await GET(req())).status).toBe(503);
    expect((await GET(req())).status).toBe(503);
    expect(findUnique()).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3001);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(findUnique()).toHaveBeenCalledTimes(2);
  });

  it("50 concurrent GETs from 50 identities while the read is pending cause one DB call and identical bodies", async () => {
    let release: (v: typeof HEARTBEAT) => void = () => {};
    findUnique().mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }) as never,
    );
    const pending = Array.from({ length: 50 }, (_, i) => GET(req(`198.51.100.${i + 1}`)));
    await Promise.resolve();
    release(HEARTBEAT);
    const responses = await Promise.all(pending);
    expect(findUnique()).toHaveBeenCalledTimes(1);
    const bodies = await Promise.all(responses.map((r) => r.text()));
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(new Set(bodies).size).toBe(1);
  });

  it("R2-7: a second module instance after vi.resetModules() shares the cache and the throttle counts", async () => {
    vi.useFakeTimers();
    const first = await import("@/lib/health/health-check");
    await first.readHealthSnapshot();
    for (let i = 0; i < 59; i++)
      expect(first.checkHealthThrottle("203.0.113.50").allowed).toBe(true);
    const callsBefore = findUnique().mock.calls.length;

    vi.resetModules();
    const second = await import("@/lib/health/health-check");
    const secondDb = await import("@/lib/db");
    expect(second).not.toBe(first);

    const snapshot = await second.readHealthSnapshot();
    expect(snapshot.status).toBe(200);
    const secondCalls =
      secondDb.prisma === prisma
        ? 0
        : vi.mocked(secondDb.prisma.systemSetting.findUnique).mock.calls.length;
    expect(findUnique().mock.calls.length + secondCalls).toBe(callsBefore);

    expect(second.checkHealthThrottle("203.0.113.50").allowed).toBe(true); // 60th
    expect(second.checkHealthThrottle("203.0.113.50").allowed).toBe(false); // 61st
  });
});

// Review b-IN-b4: a database read that never settles must not hang every health caller. The read
// is raced against a 2-second timeout inside the single-flight path, so the 503 is cached for
// the TTL like any other snapshot.
describe("GET /api/health with a hung database read (b-IN-b4)", () => {
  const findUnique = () => vi.mocked(prisma.systemSetting.findUnique);

  it("answers 503 at 2 s, not before, from one read shared by concurrent callers, then serves the cached 503", async () => {
    vi.useFakeTimers();
    findUnique().mockReturnValue(new Promise(() => {}) as never);
    const settled: number[] = [];
    const first = GET(req()).then((r) => {
      settled.push(r.status);
      return r;
    });
    const second = GET(req("203.0.113.60")).then((r) => {
      settled.push(r.status);
      return r;
    });

    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toEqual([503, 503]);
    expect(await (await first).json()).toEqual({ status: "error", db: "unreachable" });
    expect((await second).status).toBe(503);
    expect(findUnique()).toHaveBeenCalledTimes(1);

    // Cached like any snapshot: no new read inside the TTL, a fresh read after it.
    expect((await GET(req())).status).toBe(503);
    expect(findUnique()).toHaveBeenCalledTimes(1);
    findUnique().mockResolvedValue(HEARTBEAT);
    vi.advanceTimersByTime(3001);
    expect((await GET(req())).status).toBe(200);
    expect(findUnique()).toHaveBeenCalledTimes(2);
  });
});
