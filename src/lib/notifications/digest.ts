// The email digest (Phase 10, AIDA-46, D-23, D-24, D-25, C8, C10, R2-5, V-28, V-29, K166, K170,
// K179).
//
// runDigests is the scheduled job's body. Per (organization, recipient) pair:
//
//   (a) Pairs come from store.listDigestPairs, the single cross-organization read (the D-15
//       exception named in 10-04). An organization whose email is off, or has no SMTP host or
//       from address, is skipped before anything is claimed (D-24).
//   (b) Claim, one transaction: a per-pair advisory transaction lock; this pair's CLAIMED digests
//       whose lease expired become RELEASED; an unexpired CLAIMED digest left means another run
//       holds the pair, so it is skipped; store.claimDigestCandidates (FOR UPDATE SKIP LOCKED)
//       takes the recipient's own rows of the enabled types (digest and in-app switch on,
//       defaults when no row) and, when the unassigned-ticket switch is on and the recipient is an
//       owner or admin, every fallback row whatever its type; a CLAIMED NotificationDigest freezes
//       the ids with leaseExpiresAt = now + LEASE_MS.
//   (c) After the commit: the beforeSend hook, then the re-check (C8, D-25, V-28): no member row
//       cancels the digest; rows of types now switched off are left out; fallback rows are left
//       out when the recipient opted out of unassigned tickets or is no longer an owner or admin;
//       rows read, archived or digested since are left out (store.readDigestRows). Nothing left
//       cancels the digest.
//   (d) The mail (D-24, UI-SPEC, amendment A4): the constant subject, per-type counts, ticket
//       numbers and links, fallback rows on their own line. Only ticket number and id are read.
//   (e) After the beforeConnect hook, the last re-check (K181), in the same claim: the same rules
//       as (c) again, right before the connection opens, after the body was built. No member row
//       cancels the digest; rows that no longer pass are left out, and the body is rebuilt from
//       the rows already read (no further read); nothing left cancels it. Then the lease check
//       (V-29): the remaining lease must exceed the send deadline plus the commit margin, else the
//       claim is released and nothing connects. The deadline is min(SEND_DEADLINE_MS, remaining
//       lease - COMMIT_MARGIN_MS). A deactivation that commits after this re-check, while the
//       message is being transmitted, does not stop it: that digest may still arrive (the same
//       bound V-25 sets for an action already past its check; docs/OPERATIONS.md).
//   (f) Record (R2-5):
//       - accepted: the afterSend hook, then one transaction moves CLAIMED -> SENT, stamps exactly
//         the sent ids and keeps only those ids on the digest row (review c-IN-04: the row says
//         what the member received, not what was claimed);
//       - a transient rejection (4xx): CLAIMED -> RELEASED at once, nothing stamped; the next run
//         sends it once;
//       - a configuration failure (K179: the SMTP login failed, or the server refused the
//         workspace's setup rather than this recipient, digest-sender.ts): CLAIMED -> RELEASED at
//         once, nothing stamped, one log line with the class and the codes; runDigests then
//         claims none of that workspace's other pairs in this run (`config-stopped`), since they
//         would fail the same way. Once the operator fixes the settings, the next run sends them;
//       - a permanent rejection of this recipient or message (any other 5xx, K170): one
//         transaction moves CLAIMED -> CANCELED and stamps the ids it tried to send, which it
//         keeps on the row. They are never emailed, and no later run writes another
//         NotificationDigest row for them; they stay in the bell, and a new notification starts a
//         new batch;
//       - ambiguous: left CLAIMED until its lease expires, nothing stamped.
//       Every status change is conditional on the digest's own id and status CLAIMED: that is the
//       fence. An ambiguous attempt can add one copy, so repeated ambiguous failures can deliver
//       more than one duplicate; exactly-once is not claimed (docs/OPERATIONS.md).
//
// One rule for fallback rows (K166, V-28): the "Unassigned tickets" switch and the owner or admin
// role alone decide them, in the bell (emit.ts writes them without the per-type in-app switch) and
// here alike; the per-type switches govern the recipient's own tickets only. That is the copy of
// Settings -> Notifications: "Owners and admins get these, in the app and in the digest".
//
// Logging (K170): every failed send and every pair that throws writes one line with the error
// class and codes only (digest-log.ts); the job handler adds one summary line per run.
//
// Every notification read and write goes through ./store (C10); this module holds no query on
// the notification table itself. Relative imports only: the worker bundles it.
import { getAppBaseUrl } from "../app-url";
import { type EmailSettings, getEmailSettings } from "../channels/email/settings";
import { prisma } from "../db";
import { scopedDb } from "../scoped-db";
import { readMemberRights } from "../workspace-members/member-rights";
import { assertDigestTiming, DIGEST_TIMING, type DigestTiming } from "./digest-config";
import { digestErrorLabel, digestLog } from "./digest-log";
import { type DigestSendOutcome, sendDigestMail } from "./digest-sender";
import { getPreferences, getUnassignedSetting } from "./preferences";
import {
  claimDigestCandidates,
  type DigestRow,
  listDigestPairs,
  readDigestRows,
  stampDigested,
} from "./store";
import { NOTIFICATION_TYPES, type NotificationTypeName, TICKET_ENTITY } from "./types";

/** UI-SPEC Copywriting "Digest email subject": one constant, never anything about a ticket. */
export const DIGEST_EMAIL_SUBJECT = "Your AIDA updates";
export const DIGEST_EMAIL_INTRO = "Here is what happened since your last digest.";
export const DIGEST_EMAIL_FOOTER =
  "Change what you receive in AIDA under Settings → Notifications.";
export const DIGEST_FALLBACK_LABEL = "On unassigned tickets";

/** The per-type line labels, in NOTIFICATION_TYPES order. */
export const DIGEST_TYPE_LABELS: Readonly<Record<NotificationTypeName, string>> = Object.freeze({
  ASSIGNED: "Assigned to you",
  CUSTOMER_REPLY: "Customer replies",
  MENTION: "Mentions",
  SLA_AT_RISK: "SLA at risk",
  SLA_BREACHED: "SLA breached",
});

const LOCK_PREFIX = "aida:notification-digest:";

/** Identifies the digest a hook runs for. */
export interface DigestHookContext {
  digestId: string;
  organizationId: string;
  recipientUserId: string;
}

export interface RunDigestsDeps {
  /** The clock; read at the claim, the lease check and the record. Defaults to the real time. */
  now?: () => Date;
  /**
   * The pg-boss job's signal (K169): once aborted (the job expired, or the worker stops), the run
   * stops before its next claim; the pair in flight finishes.
   */
  signal?: AbortSignal;
  /** Test overrides of the timing constants, checked with assertDigestTiming. */
  timing?: Partial<DigestTiming>;
  /** Test seams, awaited in this order around one digest. */
  hooks?: {
    beforeSend?: (ctx: DigestHookContext) => Promise<void> | void;
    /** After the body was built, before the last re-check (K181) and the lease check. */
    beforeConnect?: (ctx: DigestHookContext) => Promise<void> | void;
    afterSend?: (ctx: DigestHookContext) => Promise<void> | void;
  };
}

export type DigestPairOutcome =
  | "email-off"
  | "held"
  | "nothing"
  | "canceled"
  | "lease-short"
  | DigestSendOutcome
  | "rejected-permanent"
  | "rejected-config"
  | "config-stopped"
  | "sent"
  | "fenced"
  | "failed";

export interface DigestPairReport {
  organizationId: string;
  recipientUserId: string;
  digestId: string | null;
  outcome: DigestPairOutcome;
}

export interface RunDigestsResult {
  pairs: number;
  reports: DigestPairReport[];
  /** True when the signal stopped the run before every pair was processed. */
  stopped: boolean;
}

type Clock = () => Date;

/**
 * The types whose digest and in-app switches are both on (a missing row means on). They decide the
 * recipient's own rows only; fallback rows follow the unassigned-ticket switch (K166).
 */
async function enabledDigestTypes(
  orgId: string,
  userId: string,
): Promise<Set<NotificationTypeName>> {
  const preferences = await getPreferences(orgId, userId);
  return new Set(preferences.filter((p) => p.digest && p.inApp).map((p) => p.type));
}

function emailUsable(settings: EmailSettings): boolean {
  return settings.enabled && settings.smtpHost.trim() !== "" && settings.fromAddress.trim() !== "";
}

/** The organization's email settings when a digest may be sent, else null (D-24). */
async function usableEmailSettings(orgId: string): Promise<EmailSettings | null> {
  try {
    const settings = await getEmailSettings(scopedDb(orgId));
    return emailUsable(settings) ? settings : null;
  } catch {
    // An undecryptable password reads as email off for this run; nothing is claimed.
    return null;
  }
}

interface Claim {
  digestId: string;
  ids: string[];
  leaseExpiresAt: Date;
}

/** (b) The claim transaction of one pair; null when nothing was claimed. */
async function claimPair(
  orgId: string,
  userId: string,
  now: Date,
  leaseMs: number,
): Promise<{ claim: Claim | null; held: boolean }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${LOCK_PREFIX}::text || ${orgId}::text || ':' || ${userId}::text, 0))`;

    await tx.notificationDigest.updateMany({
      where: {
        organizationId: orgId,
        recipientUserId: userId,
        status: "CLAIMED",
        leaseExpiresAt: { lt: now },
      },
      data: { status: "RELEASED" },
    });
    const held = await tx.notificationDigest.count({
      where: { organizationId: orgId, recipientUserId: userId, status: "CLAIMED" },
    });
    if (held > 0) return { claim: null, held: true };

    // A former member is not claimed at all (D-25); the re-check after commit still decides.
    const rights = await readMemberRights(tx, orgId, userId);
    if (!rights.isMember) return { claim: null, held: false };

    const enabled = await enabledDigestTypes(orgId, userId);
    const types = NOTIFICATION_TYPES.filter((type) => enabled.has(type));
    const includeFallback = (await getUnassignedSetting(orgId, userId)) && rights.isAdmin;
    const rows = await claimDigestCandidates(tx, orgId, userId, types, includeFallback);
    if (rows.length === 0) return { claim: null, held: false };

    const ids = rows.map((row) => row.id);
    const created = await tx.notificationDigest.create({
      data: {
        organizationId: orgId,
        recipientUserId: userId,
        notificationIds: ids,
        status: "CLAIMED",
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
      },
      select: { id: true, leaseExpiresAt: true },
    });
    return {
      claim: { digestId: created.id, ids, leaseExpiresAt: created.leaseExpiresAt },
      held: false,
    };
  });
}

/** A conditional CLAIMED -> status change on this digest only; true when it changed. */
async function moveClaimed(digestId: string, status: "RELEASED" | "CANCELED"): Promise<boolean> {
  const result = await prisma.notificationDigest.updateMany({
    where: { id: digestId, status: "CLAIMED" },
    data: { status },
  });
  return result.count === 1;
}

/** (c) The rows still to send after the re-check; null when the recipient is no longer a member. */
async function recheck(orgId: string, userId: string, ids: string[]): Promise<DigestRow[] | null> {
  const rights = await readMemberRights(prisma, orgId, userId);
  if (!rights.isMember) return null;
  const enabled = await enabledDigestTypes(orgId, userId);
  const fallbackAllowed = (await getUnassignedSetting(orgId, userId)) && rights.isAdmin;
  const rows = await readDigestRows(prisma, orgId, userId, ids);
  return rows.filter((row) => (row.unassignedFallback ? fallbackAllowed : enabled.has(row.type)));
}

function ticketList(
  rows: readonly DigestRow[],
  tickets: ReadonlyMap<string, number>,
  baseUrl: string,
): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const row of rows) {
    if (row.entityType !== TICKET_ENTITY || seen.has(row.entityId)) continue;
    seen.add(row.entityId);
    const number = tickets.get(row.entityId);
    if (number === undefined) continue;
    parts.push(`#${number} ${baseUrl}/tickets/${encodeURIComponent(row.entityId)}`);
  }
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/**
 * (d) The plain-text body (D-24, UI-SPEC, amendment A4): counts, ticket numbers and links only.
 * `tickets` maps a ticket id to its number; nothing else about a ticket is ever read.
 */
export function buildDigestBody(
  rows: readonly DigestRow[],
  tickets: ReadonlyMap<string, number>,
  baseUrl: string,
): string {
  const lines = [DIGEST_EMAIL_INTRO, ""];
  for (const type of NOTIFICATION_TYPES) {
    const ofType = rows.filter((row) => row.type === type && !row.unassignedFallback);
    if (ofType.length === 0) continue;
    lines.push(
      `${DIGEST_TYPE_LABELS[type]}: ${ofType.length}${ticketList(ofType, tickets, baseUrl)}`,
    );
  }
  const fallback = rows.filter((row) => row.unassignedFallback);
  if (fallback.length > 0) {
    lines.push(
      `${DIGEST_FALLBACK_LABEL}: ${fallback.length}${ticketList(fallback, tickets, baseUrl)}`,
    );
  }
  lines.push("", DIGEST_EMAIL_FOOTER);
  return lines.join("\n");
}

/** Ticket id -> number for the given rows, through one scoped read of exactly those two fields. */
async function ticketNumbers(
  orgId: string,
  rows: readonly DigestRow[],
): Promise<Map<string, number>> {
  const ids = [
    ...new Set(rows.filter((r) => r.entityType === TICKET_ENTITY).map((r) => r.entityId)),
  ];
  if (ids.length === 0) return new Map();
  const tickets = await scopedDb(orgId).ticket.findMany({
    where: { id: { in: ids } },
    select: { id: true, number: true },
  });
  return new Map(tickets.map((t) => [t.id, t.number]));
}

async function processPair(
  orgId: string,
  userId: string,
  settings: EmailSettings,
  baseUrl: string,
  clock: Clock,
  timing: DigestTiming,
  hooks: NonNullable<RunDigestsDeps["hooks"]>,
  report: DigestPairReport,
): Promise<void> {
  const { claim, held } = await claimPair(orgId, userId, clock(), timing.leaseMs);
  if (!claim) {
    report.outcome = held ? "held" : "nothing";
    return;
  }
  report.digestId = claim.digestId;
  const ctx: DigestHookContext = {
    digestId: claim.digestId,
    organizationId: orgId,
    recipientUserId: userId,
  };

  // (c) The re-check runs after beforeSend, so a change made there is seen.
  await hooks.beforeSend?.(ctx);
  const rows = await recheck(orgId, userId, claim.ids);
  if (rows === null || rows.length === 0) {
    await moveClaimed(claim.digestId, "CANCELED");
    report.outcome = "canceled";
    return;
  }
  const recipient = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  const to = recipient?.email?.trim() ?? "";
  if (to === "") {
    await moveClaimed(claim.digestId, "CANCELED");
    report.outcome = "canceled";
    return;
  }

  // (d) The mail.
  const tickets = await ticketNumbers(orgId, rows);
  let text = buildDigestBody(rows, tickets, baseUrl);

  // (e) The last re-check (K181), right before the connection opens: a deactivation or a changed
  // choice committed while the body was built is seen here. Only rows of the body can stay.
  await hooks.beforeConnect?.(ctx);
  const still = await recheck(orgId, userId, claim.ids);
  const stillIds = new Set((still ?? []).map((row) => row.id));
  const sendRows = rows.filter((row) => stillIds.has(row.id));
  if (sendRows.length === 0) {
    await moveClaimed(claim.digestId, "CANCELED");
    report.outcome = "canceled";
    return;
  }
  if (sendRows.length !== rows.length) text = buildDigestBody(sendRows, tickets, baseUrl);

  // Lease check, the last step before connecting.
  const remaining = claim.leaseExpiresAt.getTime() - clock().getTime();
  if (remaining <= timing.sendDeadlineMs + timing.commitMarginMs) {
    await moveClaimed(claim.digestId, "RELEASED");
    report.outcome = "lease-short";
    return;
  }
  const deadlineMs = Math.min(timing.sendDeadlineMs, remaining - timing.commitMarginMs);
  const result = await sendDigestMail(
    settings,
    { from: settings.fromAddress, to, subject: DIGEST_EMAIL_SUBJECT, text },
    { deadlineMs, timeoutMs: timing.smtpTimeoutMs },
  );

  // (f) Record.
  const sentIds = sendRows.map((row) => row.id);
  // A rejected recipient of a resolved send has no error object, only its reply code, if any.
  const label =
    result.errorLabel ??
    (result.responseCode !== undefined ? `reply=${result.responseCode}` : "no-error");
  if (result.outcome === "rejected" && result.configuration) {
    // K179: the operator's to fix; released, never stamped, and logged once per workspace and run
    // (runDigests attempts none of the workspace's other pairs after this one).
    digestLog(`send rejected (configuration): ${label} workspace=stopped-for-run`);
    await moveClaimed(claim.digestId, "RELEASED");
    report.outcome = "rejected-config";
    return;
  }
  if (result.outcome === "rejected" && result.permanent) {
    digestLog(`send rejected (permanent): ${label}`);
    const closed = await prisma.$transaction(async (tx) => {
      const moved = await tx.notificationDigest.updateMany({
        where: { id: claim.digestId, status: "CLAIMED" },
        data: { status: "CANCELED", notificationIds: sentIds },
      });
      if (moved.count !== 1) return false;
      await stampDigested(tx, orgId, userId, sentIds, clock());
      return true;
    });
    report.outcome = closed ? "rejected-permanent" : "fenced";
    return;
  }
  if (result.outcome === "rejected") {
    digestLog(`send rejected (transient): ${label}`);
    await moveClaimed(claim.digestId, "RELEASED");
    report.outcome = "rejected";
    return;
  }
  if (result.outcome === "ambiguous") {
    digestLog(`send ambiguous: ${label}${result.deadlineReached ? " deadline=reached" : ""}`);
    report.outcome = "ambiguous";
    return;
  }
  report.outcome = "accepted";
  await hooks.afterSend?.(ctx);
  const recorded = await prisma.$transaction(async (tx) => {
    const now = clock();
    const moved = await tx.notificationDigest.updateMany({
      where: { id: claim.digestId, status: "CLAIMED" },
      data: { status: "SENT", sentAt: now, notificationIds: sentIds },
    });
    if (moved.count !== 1) return false;
    await stampDigested(tx, orgId, userId, sentIds, now);
    return true;
  });
  report.outcome = recorded ? "sent" : "fenced";
}

/**
 * Builds and sends every due digest once. Never throws for one pair: a pair that fails is
 * reported as `failed` and left as it stands (a CLAIMED digest waits for its lease). Throws only
 * when the timing overrides are invalid or BETTER_AUTH_URL is not usable, before any claim. An
 * aborted `signal` stops the run before the next pair (`stopped`). After a configuration failure
 * (K179) the workspace's remaining pairs are reported `config-stopped` and not claimed.
 */
export async function runDigests(deps: RunDigestsDeps = {}): Promise<RunDigestsResult> {
  const timing: DigestTiming = { ...DIGEST_TIMING, ...deps.timing };
  assertDigestTiming(timing);
  const clock: Clock = deps.now ?? (() => new Date());
  const hooks = deps.hooks ?? {};
  const baseUrl = getAppBaseUrl();

  const pairs = await listDigestPairs(prisma);
  const settingsByOrg = new Map<string, EmailSettings | null>();
  // K179: workspaces whose SMTP setup was refused in this run; nothing more is attempted for them.
  const configStopped = new Set<string>();
  const reports: DigestPairReport[] = [];
  let stopped = false;

  for (const pair of pairs) {
    if (deps.signal?.aborted) {
      stopped = true;
      break;
    }
    const report: DigestPairReport = {
      organizationId: pair.organizationId,
      recipientUserId: pair.recipientUserId,
      digestId: null,
      outcome: "nothing",
    };
    reports.push(report);
    if (configStopped.has(pair.organizationId)) {
      report.outcome = "config-stopped";
      continue;
    }
    try {
      if (!settingsByOrg.has(pair.organizationId)) {
        settingsByOrg.set(pair.organizationId, await usableEmailSettings(pair.organizationId));
      }
      const settings = settingsByOrg.get(pair.organizationId) ?? null;
      if (!settings) {
        report.outcome = "email-off";
        continue;
      }
      await processPair(
        pair.organizationId,
        pair.recipientUserId,
        settings,
        baseUrl,
        clock,
        timing,
        hooks,
        report,
      );
      if (report.outcome === "rejected-config") configStopped.add(pair.organizationId);
    } catch (err) {
      digestLog(`pair failed: ${digestErrorLabel(err)}`);
      report.outcome = "failed";
    }
  }
  return { pairs: pairs.length, reports, stopped };
}
