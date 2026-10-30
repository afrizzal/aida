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

export type HealthSnapshot = { status: number; body: Record<string, unknown> };

type HealthState = {
  perIdentity: MemoryThrottle;
  shared: MemoryThrottle;
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

export async function readHealthSnapshot(): Promise<HealthSnapshot> {
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
}
