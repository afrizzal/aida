// A unique, valid client address for each request a test sends to a public route (08-gap1,
// review d-WR-d4). getClientIp maps a missing or non-IP X-Forwarded-For to one shared bucket
// (08-10), so a test that sends no header, or a label such as `provenance-<uuid>`, shares a
// quota with every other such test, and passes or fails by file order and by pepper. IPv6 is
// keyed by its /64, so every call gets its own random /64 inside fd00::/8 (unique local, never
// routed). Tests that prove a limit on purpose reuse one value for the requests of that case.
//
// Relative imports only.
import { randomUUID } from "node:crypto";

export function uniqueClientIp(): string {
  const hex = randomUUID().replace(/-/g, "");
  return `fd00:${hex.slice(0, 4)}:${hex.slice(4, 8)}:${hex.slice(8, 12)}::1`;
}

/** Headers for one public-route request from a fresh client address. */
export function uniqueClientHeaders(): { "x-forwarded-for": string } {
  return { "x-forwarded-for": uniqueClientIp() };
}
