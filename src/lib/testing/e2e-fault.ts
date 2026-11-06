/**
 * E2E fault hook (AIDA-36, D-14, plan 09-09; threat T-09-31): lets the E2E suite render a route's
 * error.tsx and its Suspense fallback in the browser, which no request can otherwise reach.
 *
 * Inert outside the E2E server. The gate is two conditions together and is checked before any
 * request input is read:
 * - NODE_ENV is not "production". `process.env.NODE_ENV` is written out literally below, so Next
 *   inlines it at build time and the body after the check is dead code in a production build;
 *   `next start` runs with NODE_ENV "production" as well.
 * - AIDA_E2E_FAULTS is exactly "1". Only tests/e2e/global-setup.ts sets it, on the `next dev`
 *   server it spawns.
 * Only when both hold is the `aida-e2e-fault` cookie read. A cookie on its own never acts. The
 * thrown error names only the fault point.
 */
import { cookies } from "next/headers";

/** The request cookie that names the fault point to trigger. */
export const E2E_FAULT_COOKIE = "aida-e2e-fault";

/** How long the delay point holds the render, so E2E can see the Suspense fallback. */
export const E2E_FAULT_DELAY_MS = 4000;

export const E2E_FAULT_POINTS = [
  "tickets-page",
  "ticket-detail-page",
  "contacts-page",
  "contact-detail-page",
  // Pages with no error.tsx of their own: the app-level src/app/(app)/error.tsx renders (K147).
  "kb-page",
  "settings-backups-page",
  "tickets-list-delay",
] as const;

export type E2EFaultPoint = (typeof E2E_FAULT_POINTS)[number];

export type E2EFaultAction = "throw" | "delay";

/** The two server settings the gate reads. */
export interface E2EFaultEnv {
  readonly NODE_ENV?: string;
  readonly AIDA_E2E_FAULTS?: string;
}

const DELAY_POINT: E2EFaultPoint = "tickets-list-delay";

/** True only on a non-production server with the E2E fault flag set to exactly "1". */
export function e2eFaultGateOpen(env: E2EFaultEnv): boolean {
  return env.NODE_ENV !== "production" && env.AIDA_E2E_FAULTS === "1";
}

/**
 * The action for `point`, or null. Null whenever the gate is closed, and when the cookie value is
 * absent or names a different point.
 */
export function resolveE2EFault(
  env: E2EFaultEnv,
  cookieValue: string | undefined,
  point: E2EFaultPoint,
): E2EFaultAction | null {
  if (!e2eFaultGateOpen(env)) return null;
  if (cookieValue !== point) return null;
  return point === DELAY_POINT ? "delay" : "throw";
}

/**
 * Called as the first statement of a page or server component. Does nothing unless the gate is
 * open and the request's fault cookie names `point`; then a page point throws (the route's
 * error.tsx renders) and the delay point waits E2E_FAULT_DELAY_MS (the Suspense fallback shows).
 */
export async function e2eFault(point: E2EFaultPoint): Promise<void> {
  if (process.env.NODE_ENV === "production") return;
  if (process.env.AIDA_E2E_FAULTS !== "1") return;

  const cookieValue = (await cookies()).get(E2E_FAULT_COOKIE)?.value;
  const action = resolveE2EFault(
    { NODE_ENV: process.env.NODE_ENV, AIDA_E2E_FAULTS: process.env.AIDA_E2E_FAULTS },
    cookieValue,
    point,
  );
  if (action === "throw") throw new Error(`E2E fault: ${point}`);
  if (action === "delay") {
    await new Promise<void>((resolve) => setTimeout(resolve, E2E_FAULT_DELAY_MS));
  }
}
