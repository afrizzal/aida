// The email digest's operator setting and timing (Phase 10, AIDA-46, D-23, D-24, V-15, V-29).
//
// AIDA_DIGEST_INTERVAL_HOURS sets how often the worker builds digests: one of 1, 2, 3, 4, 6, 8,
// 12 or 24 (hours that divide a day, so the cron stays regular); anything else, or nothing,
// means 4. The worker reads it once at start, so a change takes effect on worker restart.
//
// Timing (V-29): a claim holds its batch for LEASE_MS. One send is cut off at SEND_DEADLINE_MS by
// destroying the socket the digest sender owns; COMMIT_MARGIN_MS is kept free after the deadline
// for the recording transaction. SMTP_TIMEOUT_MS is nodemailer's per-step inactivity timeout,
// which alone bounds nothing (a trickling server resets it), so the deadline must exceed it.
// assertDigestTiming enforces both inequalities, at module load for the shipped values and in
// runDigests for any test override.
//
// Relative imports only (none) and no framework import: the worker bundles this module.

export const NOTIFICATION_DIGEST_QUEUE = "notification-digest";

/** The allowed values of AIDA_DIGEST_INTERVAL_HOURS. */
export const DIGEST_INTERVAL_HOURS = [1, 2, 3, 4, 6, 8, 12, 24] as const;
export type DigestIntervalHours = (typeof DIGEST_INTERVAL_HOURS)[number];
export const DEFAULT_DIGEST_INTERVAL_HOURS: DigestIntervalHours = 4;

const ALLOWED: ReadonlySet<number> = new Set(DIGEST_INTERVAL_HOURS);

type Env = Record<string, string | undefined>;

/** The configured interval in hours; 4 when the variable is unset, empty or not allowed. */
export function digestIntervalHours(env: Env = process.env): DigestIntervalHours {
  const raw = env.AIDA_DIGEST_INTERVAL_HOURS?.trim() ?? "";
  if (!/^\d{1,2}$/.test(raw)) return DEFAULT_DIGEST_INTERVAL_HOURS;
  const value = Number(raw);
  return ALLOWED.has(value) ? (value as DigestIntervalHours) : DEFAULT_DIGEST_INTERVAL_HOURS;
}

/** The pg-boss cron of the digest schedule: on the hour every N hours, or daily at midnight. */
export function digestCron(env: Env = process.env): string {
  const hours = digestIntervalHours(env);
  if (hours === 24) return "0 0 * * *";
  if (hours === 1) return "0 * * * *";
  return `0 */${hours} * * *`;
}

/** The cadence in words, for the preferences page: "every hour", "every N hours", "once a day". */
export function digestIntervalText(env: Env = process.env): string {
  const hours = digestIntervalHours(env);
  if (hours === 1) return "every hour";
  if (hours === 24) return "once a day";
  return `every ${hours} hours`;
}

/** Wall-clock bound on one digest send; the sender destroys its socket when it passes. */
export const SEND_DEADLINE_MS = 45_000;
/** Time kept free between the send deadline and the lease expiry, for recording the result. */
export const COMMIT_MARGIN_MS = 15_000;
/** How long a claim holds its batch before another run may release and reclaim it. */
export const LEASE_MS = 300_000;
/** nodemailer's connection, greeting and socket (inactivity) timeout for a digest send. */
export const SMTP_TIMEOUT_MS = 10_000;

export interface DigestTiming {
  sendDeadlineMs: number;
  commitMarginMs: number;
  leaseMs: number;
  smtpTimeoutMs: number;
}

export const DIGEST_TIMING: Readonly<DigestTiming> = Object.freeze({
  sendDeadlineMs: SEND_DEADLINE_MS,
  commitMarginMs: COMMIT_MARGIN_MS,
  leaseMs: LEASE_MS,
  smtpTimeoutMs: SMTP_TIMEOUT_MS,
});

/**
 * Throws unless every value is a positive finite number, the lease exceeds the send deadline
 * plus the commit margin, and the send deadline exceeds the SMTP timeout (V-29).
 */
export function assertDigestTiming(t: DigestTiming): void {
  for (const [name, value] of Object.entries(t)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new Error(`digest timing: ${name} must be a positive number`);
    }
  }
  if (!(t.leaseMs > t.sendDeadlineMs + t.commitMarginMs)) {
    throw new Error(
      "digest timing: the lease must exceed the send deadline plus the commit margin",
    );
  }
  if (!(t.sendDeadlineMs > t.smtpTimeoutMs)) {
    throw new Error("digest timing: the send deadline must exceed the SMTP timeout");
  }
}

assertDigestTiming(DIGEST_TIMING);
