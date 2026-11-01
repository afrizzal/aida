import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as probeGET } from "@/app/api/health/probe/route";
import { GET as healthGET } from "@/app/api/health/route";
import { prisma } from "@/lib/db";
import { resetHealthStateForTests } from "@/lib/health/health-check";
import { resetClientIpLogStateForTests } from "@/lib/rate-limit/client-ip";

// Mock the DB module so no real Postgres connection is needed (same pattern as health.test.ts).
// This is an in-process bound; plan 08-21 measures it on the production build (review R2-7).
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

const INTERVAL_MS = 10_000;
const INTERVALS = 6;
const FLOOD_PER_BUCKET = 100;

function healthReq(xff?: string): Request {
  return new Request("http://localhost/api/health", {
    headers: xff ? { "x-forwarded-for": xff } : {},
  });
}

// The probe GET takes no request argument; it is called the way Next.js would call it, and the
// header tests below show that nothing a client sends can reach its decision.
function callProbe(): Promise<Response> {
  return (probeGET as (request?: Request) => Promise<Response>)(
    new Request("http://localhost/api/health/probe"),
  );
}

const findUnique = () => vi.mocked(prisma.systemSetting.findUnique);

// d-IN-d2: every case starts from TRUSTED_PROXY_HOPS blank (the shipped default), never from
// the shell's value; cases that need another count set it themselves.
beforeEach(() => {
  vi.stubEnv("TRUSTED_PROXY_HOPS", "");
  resetHealthStateForTests();
  resetClientIpLogStateForTests();
  findUnique().mockReset();
  findUnique().mockResolvedValue(HEARTBEAT);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("GET /api/health/probe", () => {
  it("D-20: answers 200 with exactly { status: ok } from the snapshot when the DB is up", async () => {
    const res = await callProbe();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("D-20: answers 503 with exactly { status: error } when the DB read fails", async () => {
    findUnique().mockRejectedValueOnce(new Error("DB unreachable"));
    const res = await callProbe();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "error" });
  });

  it("C2: request headers change nothing (X-Forwarded-For, spoofed identity, arbitrary headers)", async () => {
    const plain = await callProbe();
    const plainBody = await plain.json();
    const headerSets: Record<string, string>[] = [
      { "x-forwarded-for": "127.0.0.1" },
      { "x-forwarded-for": "203.0.113.9, 198.51.100.7" },
      { "x-aida-client-ip": "10.0.0.1", "x-real-ip": "10.0.0.2" },
      { authorization: "Bearer anything", "x-health-exempt": "1", "user-agent": "curl/8" },
    ];
    for (const headers of headerSets) {
      const res = await (probeGET as (request?: Request) => Promise<Response>)(
        new Request("http://localhost/api/health/probe", { headers }),
      );
      expect(res.status).toBe(plain.status);
      expect(await res.json()).toEqual(plainBody);
    }
  });

  it("C2: flooding the shared bucket, the loopback identity and the probe path for six intervals never turns the probe away; DB reads stay bounded", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T00:00:00.000Z"));

    const finalProbe: number[] = [];
    const floodProbe: number[] = [];
    const sharedStatuses: number[] = [];
    const loopbackStatuses: number[] = [];

    for (let interval = 0; interval < INTERVALS; interval++) {
      for (let i = 0; i < FLOOD_PER_BUCKET; i++) {
        sharedStatuses.push((await healthGET(healthReq())).status);
        loopbackStatuses.push((await healthGET(healthReq("127.0.0.1"))).status);
        floodProbe.push((await callProbe()).status);
      }
      finalProbe.push((await callProbe()).status);
      vi.advanceTimersByTime(INTERVAL_MS);
    }

    expect(finalProbe).toEqual(Array(INTERVALS).fill(200));
    expect(floodProbe).toHaveLength(INTERVALS * FLOOD_PER_BUCKET);
    expect(floodProbe.every((s) => s === 200)).toBe(true);
    expect(sharedStatuses).toContain(429);
    expect(loopbackStatuses).toContain(429);

    // D-20 single-flight bound: at most one read per 3-second window over the minute, plus the
    // first read (60 s / 3 s + 1 = 21).
    const reads = findUnique().mock.calls.length;
    console.info(`C2 flood: findUnique called ${reads} times over ${INTERVALS} intervals`);
    expect(reads).toBeGreaterThanOrEqual(1);
    expect(reads).toBeLessThanOrEqual(21);
  });

  it("C2: with TRUSTED_PROXY_HOPS=3 every chain fails closed into the shared bucket, and the probe still answers 200", async () => {
    const saved = process.env.TRUSTED_PROXY_HOPS;
    try {
      process.env.TRUSTED_PROXY_HOPS = "3";
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-11T00:00:00.000Z"));

      const finalProbe: number[] = [];
      for (let interval = 0; interval < INTERVALS; interval++) {
        const statuses: number[] = [];
        for (let i = 0; i < 200; i++) {
          // Single-entry chains, distinct addresses: too short for three hops, so all shared.
          statuses.push((await healthGET(healthReq(`198.51.100.${(i % 250) + 1}`))).status);
        }
        if (interval === 0) {
          expect(statuses.slice(0, 120).every((s) => s === 200)).toBe(true);
          expect(statuses.slice(120).every((s) => s === 429)).toBe(true);
        } else {
          expect(statuses).toContain(429);
        }
        finalProbe.push((await callProbe()).status);
        vi.advanceTimersByTime(INTERVAL_MS);
      }

      expect(finalProbe).toEqual(Array(INTERVALS).fill(200));
    } finally {
      if (saved === undefined) delete process.env.TRUSTED_PROXY_HOPS;
      else process.env.TRUSTED_PROXY_HOPS = saved;
    }
  });
});
