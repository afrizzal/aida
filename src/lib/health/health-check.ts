// /api/health throttle and snapshot (D-20, AIDA-30, F-12).
// Route files may export only Next.js route fields, so the state and the test reset live here.
import { prisma } from "@/lib/db";
import { SHARED_CLIENT_BUCKET } from "@/lib/rate-limit/client-ip";
import { createMemoryThrottle, type MemoryThrottle } from "@/lib/rate-limit/memory-throttle";

// The container healthcheck sends 6 requests a minute. These values are tunable (Claude's
// discretion within D-20): the shared bucket for callers without a client address is 20 times
// the probe rate, and `maxKeys` bounds memory under an address flood.
export const HEALTH_THROTTLE = {
  perIdentity: { limit: 60, windowMs: 60_000 },
  shared: { limit: 120, windowMs: 60_000 },
  maxKeys: 10_000,
} as const;

// Within D-20's 2 to 5 seconds. The reported status may lag reality by up to 3 seconds,
// in both directions: an outage and a recovery each show after at most one TTL.
export const HEALTH_CACHE_TTL_MS = 3000;

export type HealthSnapshot = { status: number; body: Record<string, unknown> };

type HealthState = {
  perIdentity: MemoryThrottle;
  shared: MemoryThrottle;
  cached: { expiresAt: number; snapshot: HealthSnapshot } | null;
  inFlight: Promise<HealthSnapshot> | null;
};

// A production build may instantiate this module once per route bundle. Keeping the state on
// globalThis under a registered symbol gives /api/health and the plan 08-20 probe one shared
// state per process (review R2-7).
const STATE_KEY = Symbol.for("aida.health.state");

function healthState(): HealthState {
  const g = globalThis as typeof globalThis & { [STATE_KEY]?: HealthState };
  let state = g[STATE_KEY];
  if (!state) {
    state = {
      perIdentity: createMemoryThrottle({
        ...HEALTH_THROTTLE.perIdentity,
        maxKeys: HEALTH_THROTTLE.maxKeys,
      }),
      shared: createMemoryThrottle({ ...HEALTH_THROTTLE.shared, maxKeys: 1 }),
      cached: null,
      inFlight: null,
    };
    g[STATE_KEY] = state;
  }
  return state;
}

export function checkHealthThrottle(identity: string): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  const state = healthState();
  const throttle = identity === SHARED_CLIENT_BUCKET ? state.shared : state.perIdentity;
  return throttle.consume(identity);
}

// The only path from health to the database: /api/health and the plan 08-20 probe both call it,
// so together they cost at most one DB read per TTL per process. The result is cached whether it
// is 200 or 503, and concurrent callers share one in-flight read (single-flight).
export function readHealthSnapshot(): Promise<HealthSnapshot> {
  const state = healthState();
  if (state.cached && Date.now() < state.cached.expiresAt) {
    return Promise.resolve(state.cached.snapshot);
  }
  if (state.inFlight) return state.inFlight;

  const read = queryHealth()
    .then((snapshot) => {
      state.cached = { expiresAt: Date.now() + HEALTH_CACHE_TTL_MS, snapshot };
      return snapshot;
    })
    .finally(() => {
      state.inFlight = null;
    });
  state.inFlight = read;
  return read;
}

async function queryHealth(): Promise<HealthSnapshot> {
  try {
    const hb = await prisma.systemSetting.findUnique({
      where: { key: "heartbeat:lastRunAt" },
    });
    return {
      status: 200,
      body: {
        status: "ok",
        db: "connected",
        worker: hb?.value ? { lastRunAt: hb.value } : { status: "no heartbeat yet" },
      },
    };
  } catch {
    return { status: 503, body: { status: "error", db: "unreachable" } };
  }
}

export function resetHealthStateForTests(): void {
  const state = healthState();
  state.perIdentity.reset();
  state.shared.reset();
  state.cached = null;
  state.inFlight = null;
}
