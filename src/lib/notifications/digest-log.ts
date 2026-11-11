// What the digest writes to the worker log (Phase 10, run decision K170, review c-WR-05).
//
// An operator must see that digests fail and why, but an error's message, and an SMTP server's
// reply text, can carry a recipient address or other content. So a failure is logged as its error
// class and its codes only: the class (`err.name`), a short identifier code (`err.code`, for example
// nodemailer's EENVELOPE or EAUTH, or Prisma's P2002) and the SMTP reply code. Each is kept only
// when it is a plain identifier or number; anything else is dropped. Never an address, an id, a
// ticket, a subject or a message.
//
// Relative imports only (none) and no framework import: the worker bundles this module.

const NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const CODE = /^[A-Za-z0-9_]{1,32}$/;

/** `class=<name>[ code=<code>][ reply=<smtp code>]`; `class=unknown` for anything unrecognised. */
export function digestErrorLabel(err: unknown): string {
  if (!(err instanceof Error) || !NAME.test(err.name)) return "class=unknown";
  const parts = [`class=${err.name}`];
  const { code, responseCode } = err as { code?: unknown; responseCode?: unknown };
  if (typeof code === "string" && CODE.test(code)) parts.push(`code=${code}`);
  if (typeof responseCode === "number" && Number.isInteger(responseCode)) {
    if (responseCode >= 100 && responseCode <= 999) parts.push(`reply=${responseCode}`);
  }
  return parts.join(" ");
}

/** The counts of one run by outcome: the summary line's fields, in a fixed order. */
export function digestRunSummary(result: {
  pairs: number;
  reports: readonly { outcome: string }[];
  stopped: boolean;
}): string {
  const count = (outcome: string) => result.reports.filter((r) => r.outcome === outcome).length;
  return [
    `pairs=${result.pairs}`,
    `sent=${count("sent")}`,
    `rejected=${count("rejected")}`,
    `rejectedPermanent=${count("rejected-permanent")}`,
    `ambiguous=${count("ambiguous")}`,
    `failed=${count("failed")}`,
    `leaseShort=${count("lease-short")}`,
    `stopped=${result.stopped}`,
  ].join(" ");
}

/** Writes one line; a failure to log never replaces the digest's own outcome. */
export function digestLog(line: string): void {
  try {
    console.error(`[notification-digest] ${line}`);
  } catch {
    // Logging must never change what the digest does.
  }
}
