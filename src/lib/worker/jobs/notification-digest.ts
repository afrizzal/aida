// The scheduled email digest (Phase 10, AIDA-46, D-23, D-24, V-15).
//
// Runs one pass of runDigests: every due (organization, recipient) pair is claimed under a lease,
// re-checked, sent through the organization's configured SMTP and recorded only on the server's
// final acceptance. The queue has policy singleton, so a slow run never overlaps the next one;
// the per-pair advisory lock and the lease keep two runs apart anyway. The schedule comes from
// AIDA_DIGEST_INTERVAL_HOURS (digest-config.ts), read once when the worker starts. Links use
// BETTER_AUTH_URL, which the worker therefore needs in its environment.
//
// Logs counts only: never an address, an id or a ticket. Relative imports only: the worker
// bundles this module.
import { type RunDigestsResult, runDigests } from "../../notifications/digest";

/** The pg-boss handler; the scheduled payload is empty and is not read. */
export async function notificationDigestHandler(_jobs?: unknown): Promise<RunDigestsResult> {
  const result = await runDigests();
  const failed = result.reports.filter((report) => report.outcome === "failed").length;
  if (failed > 0) {
    console.error(`[notification-digest] ${failed} of ${result.pairs} recipients failed`);
  }
  return result;
}
