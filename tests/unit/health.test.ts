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

beforeEach(() => {
  resetHealthStateForTests();
  vi.mocked(prisma.systemSetting.findUnique).mockReset();
  vi.mocked(prisma.systemSetting.findUnique).mockResolvedValue(HEARTBEAT);
});

afterEach(() => {
  vi.useRealTimers();
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

  it("healthcheck: one no-identity GET every 10 s for 10 minutes stays 200 under a 100/min flood", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T00:00:00.000Z"));
    const probeStatuses: number[] = [];
    let flooderDenied = 0;
    for (let tick = 0; tick < 60; tick++) {
      // 100 requests per minute from the flooder, spread across the six probe ticks.
      const floodThisTick = tick % 6 < 4 ? 17 : 16;
      for (let i = 0; i < floodThisTick; i++) {
        if ((await GET(req("203.0.113.41"))).status === 429) flooderDenied++;
      }
      probeStatuses.push((await GET(req())).status);
      vi.advanceTimersByTime(10_000);
    }
    expect(probeStatuses).toHaveLength(60);
    expect(probeStatuses.every((s) => s === 200)).toBe(true);
    expect(flooderDenied).toBeGreaterThan(0);
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
