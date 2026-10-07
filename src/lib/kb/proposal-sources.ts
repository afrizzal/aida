// KB proposal sources (Phase 12.2, AIDA-18, plan 12.2-04): the one module the request, the
// generation job (plan 12.2-07) and the review page (plan 12.2-08) share for source rules and
// generation input.
//
//   * checkSourceEligibility: the request-time rule (D-07). A ticket is eligible when its state's
//     GROUP (never a state name, read through readStateGroups) is RESOLVED or CLOSED and it is not
//     merged. Reasons: NOT_RESOLVED, MERGED (with the target's number), NOT_FOUND (unknown id and
//     another organization's id are indistinguishable), DUPLICATE (second occurrence of an id).
//   * recheckSourceEligibility: the same rule on a stored proposal's sources, run by the job
//     before any ticket text is read (D-08). It reads no Message row.
//   * loadSourceInputs: the generation input (D-10). Only the subject and PUBLIC messages, in seq
//     order, at most MAX_MESSAGES_PER_SOURCE + 1 per ticket (the prompt builder cuts and flags the
//     truncation), each with its fixed role from the direction (customer or agent, review
//     a2-IN-06). Never INTERNAL notes, attachments, author names or contact fields. Per ticket it also returns
//     the snapshot marker: the ticket's actual largest PUBLIC seq, from an aggregate over all of
//     its PUBLIC messages that runs BEFORE the bounded read (null without a PUBLIC message). A
//     truncated source is therefore not reported as changed right after generation, and a message
//     added between the two reads can only cause a warning, never hide a change.
//   * findChangedSources: the ticket numbers of sources that lost eligibility or whose largest
//     PUBLIC seq, read by the same aggregate, is now greater than the stored snapshotSeq (D-08).
//
// Message.seq is a database-wide BigInt (review P1): every seq on this path stays a bigint and is
// compared with bigint operators; none is ever converted to a JavaScript number.
//
// Every statement is raw SQL with an explicit organizationId term, so any client fits (the global
// client, a transaction client, a scopedDb transaction). No lock is taken: the request and the
// job read, and the job's recheck guards the window between them.
//
// Relative imports only: the worker bundles this module.

import { readStateGroups, type StateQueryClient } from "../tickets/ticket-states";
import {
  ELIGIBLE_SOURCE_GROUPS,
  type EligibleSourceGroup,
  type TicketRefusalReason,
} from "./proposal-contract";
import { MAX_MESSAGES_PER_SOURCE, type ProposalSourceInput } from "./proposal-prompt";

/** The client every function here needs: one tagged raw query. */
export type SourceQueryClient = StateQueryClient;

/** One failing ticket of a request, in selection order (D-07). */
export interface SourceRefusal {
  ticketId: string;
  reason: TicketRefusalReason;
  /** Set for MERGED: the number of the ticket the source was merged into. */
  mergedIntoNumber?: number;
}

export interface EligibleSource {
  id: string;
  number: number;
  /** 1 to n in selection order. */
  position: number;
}

export type SourceEligibilityResult =
  | { ok: true; tickets: EligibleSource[] }
  | { ok: false; refusals: SourceRefusal[] };

/** A stored source that no longer passes the request rule (DUPLICATE cannot occur there). */
export interface ChangedSource {
  ticketId: string;
  reason: Exclude<TicketRefusalReason, "DUPLICATE">;
}

export type SourceRecheckResult = { ok: true } | { ok: false; changed: ChangedSource[] };

export interface LoadedSourceInputs {
  /** In position order; a ticket the organization cannot read is absent. */
  inputs: ProposalSourceInput[];
  /** Per read ticket id: its largest PUBLIC seq at read time, or null without a PUBLIC message. */
  snapshots: Record<string, bigint | null>;
}

const ELIGIBLE_GROUPS: ReadonlySet<string> = new Set<EligibleSourceGroup>(ELIGIBLE_SOURCE_GROUPS);

interface TicketRuleRow {
  id: string;
  number: number;
  stateId: string;
  mergedIntoTicketId: string | null;
}

type RuleVerdict =
  | { eligible: true; number: number }
  | { eligible: false; reason: "NOT_FOUND" }
  | {
      eligible: false;
      reason: "NOT_RESOLVED" | "MERGED";
      number: number;
      mergedIntoNumber?: number;
    };

/**
 * The shared eligibility rule: one ticket query and one merge-target query, both with the
 * organization term, and readStateGroups for the groups. Returns a verdict per distinct id.
 */
async function evaluateTickets(
  client: SourceQueryClient,
  orgId: string,
  ticketIds: readonly string[],
): Promise<Map<string, RuleVerdict>> {
  const verdicts = new Map<string, RuleVerdict>();
  const unique = [...new Set(ticketIds)];
  if (unique.length === 0) return verdicts;

  const rows = await client.$queryRaw<TicketRuleRow[]>`
    SELECT id, number, "stateId", "mergedIntoTicketId"
    FROM "Ticket"
    WHERE "organizationId" = ${orgId} AND id = ANY(${unique}::text[])
  `;
  const byId = new Map(rows.map((row) => [row.id, row]));

  const targetIds = [
    ...new Set(rows.map((row) => row.mergedIntoTicketId).filter((id): id is string => id !== null)),
  ];
  const targetNumbers = new Map<string, number>();
  if (targetIds.length > 0) {
    const targets = await client.$queryRaw<{ id: string; number: number }[]>`
      SELECT id, number
      FROM "Ticket"
      WHERE "organizationId" = ${orgId} AND id = ANY(${targetIds}::text[])
    `;
    for (const target of targets) targetNumbers.set(target.id, target.number);
  }

  const groups = await readStateGroups(
    client,
    orgId,
    rows.map((row) => row.stateId),
  );

  for (const id of unique) {
    const row = byId.get(id);
    if (!row) {
      verdicts.set(id, { eligible: false, reason: "NOT_FOUND" });
      continue;
    }
    if (row.mergedIntoTicketId !== null) {
      const mergedIntoNumber = targetNumbers.get(row.mergedIntoTicketId);
      verdicts.set(id, {
        eligible: false,
        reason: "MERGED",
        number: row.number,
        ...(mergedIntoNumber !== undefined ? { mergedIntoNumber } : {}),
      });
      continue;
    }
    const group = groups.get(row.stateId);
    if (group === undefined || !ELIGIBLE_GROUPS.has(group)) {
      verdicts.set(id, { eligible: false, reason: "NOT_RESOLVED", number: row.number });
      continue;
    }
    verdicts.set(id, { eligible: true, number: row.number });
  }
  return verdicts;
}

function isTicketId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * The request-time rule (D-07): ok with the tickets in selection order (positions 1 to n), or
 * every failing ticket with one typed reason, never a silent drop. The count (1 to 5) is the
 * caller's check. A value that is not a non-empty string is NOT_FOUND.
 */
export async function checkSourceEligibility(
  client: SourceQueryClient,
  orgId: string,
  ticketIds: readonly unknown[],
): Promise<SourceEligibilityResult> {
  const verdicts = await evaluateTickets(client, orgId, ticketIds.filter(isTicketId));
  const seen = new Set<string>();
  const refusals: SourceRefusal[] = [];
  const tickets: EligibleSource[] = [];

  for (const value of ticketIds) {
    if (!isTicketId(value)) {
      refusals.push({ ticketId: String(value), reason: "NOT_FOUND" });
      continue;
    }
    if (seen.has(value)) {
      refusals.push({ ticketId: value, reason: "DUPLICATE" });
      continue;
    }
    seen.add(value);
    const verdict = verdicts.get(value) ?? { eligible: false, reason: "NOT_FOUND" as const };
    if (verdict.eligible) {
      tickets.push({ id: value, number: verdict.number, position: tickets.length + 1 });
    } else if (verdict.reason === "MERGED") {
      refusals.push({
        ticketId: value,
        reason: "MERGED",
        ...(verdict.mergedIntoNumber !== undefined
          ? { mergedIntoNumber: verdict.mergedIntoNumber }
          : {}),
      });
    } else {
      refusals.push({ ticketId: value, reason: verdict.reason });
    }
  }

  if (refusals.length > 0) return { ok: false, refusals };
  return { ok: true, tickets };
}

interface StoredSourceRow {
  ticketId: string;
  position: number;
  snapshotSeq: bigint | null;
}

async function readStoredSources(
  client: SourceQueryClient,
  orgId: string,
  proposalId: string,
): Promise<StoredSourceRow[]> {
  return client.$queryRaw<StoredSourceRow[]>`
    SELECT "ticketId", position, "snapshotSeq"
    FROM "KbProposalSource"
    WHERE "organizationId" = ${orgId} AND "proposalId" = ${proposalId}
    ORDER BY position
  `;
}

/**
 * The job's recheck (D-08): the request rule on the proposal's stored sources, without reading
 * any message text. A proposal with no readable source is refused with an empty list
 * (fail-closed: no ticket text may be read for it).
 */
export async function recheckSourceEligibility(
  client: SourceQueryClient,
  orgId: string,
  proposalId: string,
): Promise<SourceRecheckResult> {
  const sources = await readStoredSources(client, orgId, proposalId);
  if (sources.length === 0) return { ok: false, changed: [] };
  const verdicts = await evaluateTickets(
    client,
    orgId,
    sources.map((source) => source.ticketId),
  );
  const changed: ChangedSource[] = [];
  for (const source of sources) {
    const verdict = verdicts.get(source.ticketId);
    if (!verdict) changed.push({ ticketId: source.ticketId, reason: "NOT_FOUND" });
    else if (!verdict.eligible) changed.push({ ticketId: source.ticketId, reason: verdict.reason });
  }
  return changed.length > 0 ? { ok: false, changed } : { ok: true };
}

/**
 * The one snapshot aggregate (D-08): the largest PUBLIC seq per given ticket of the
 * organization, over all of its PUBLIC messages. A ticket without a PUBLIC message is absent.
 */
async function readLargestPublicSeqs(
  client: SourceQueryClient,
  orgId: string,
  ticketIds: readonly string[],
): Promise<Map<string, bigint>> {
  if (ticketIds.length === 0) return new Map();
  const rows = await client.$queryRaw<{ ticketId: string; maxSeq: bigint }[]>`
    SELECT "ticketId", MAX(seq) AS "maxSeq"
    FROM "Message"
    WHERE "organizationId" = ${orgId}
      AND "ticketId" = ANY(${[...ticketIds]}::text[])
      AND visibility = 'PUBLIC'
    GROUP BY "ticketId"
  `;
  return new Map(rows.map((row) => [row.ticketId, BigInt(row.maxSeq)]));
}

/**
 * The generation input (D-10): subject and PUBLIC messages in seq order, at most
 * MAX_MESSAGES_PER_SOURCE + 1 per ticket, in position order, plus the snapshot marker per ticket
 * taken before the bounded read. A ticket the organization cannot read returns nothing.
 */
export async function loadSourceInputs(
  client: SourceQueryClient,
  orgId: string,
  sources: readonly { ticketId: string; position: number }[],
): Promise<LoadedSourceInputs> {
  const ordered = [...sources].sort((a, b) => a.position - b.position);
  const ids = [...new Set(ordered.map((source) => source.ticketId))];
  if (ids.length === 0) return { inputs: [], snapshots: {} };

  const tickets = await client.$queryRaw<{ id: string; subject: string }[]>`
    SELECT id, subject
    FROM "Ticket"
    WHERE "organizationId" = ${orgId} AND id = ANY(${ids}::text[])
  `;
  const subjects = new Map(tickets.map((ticket) => [ticket.id, ticket.subject]));
  const readable = ids.filter((id) => subjects.has(id));

  // The snapshot first: a message committed after this read can only make the source look
  // changed later, never hide a change.
  const largest = await readLargestPublicSeqs(client, orgId, readable);
  const snapshots: Record<string, bigint | null> = {};
  for (const id of readable) snapshots[id] = largest.get(id) ?? null;

  const limit = MAX_MESSAGES_PER_SOURCE + 1;
  const inputs: ProposalSourceInput[] = [];
  for (const source of ordered) {
    const subject = subjects.get(source.ticketId);
    if (subject === undefined) continue;
    const messages = await client.$queryRaw<{ seq: bigint; body: string; direction: string }[]>`
      SELECT seq, "bodyMarkdown" AS body, direction::text AS direction
      FROM "Message"
      WHERE "organizationId" = ${orgId}
        AND "ticketId" = ${source.ticketId}
        AND visibility = 'PUBLIC'
      ORDER BY seq
      LIMIT ${limit}
    `;
    inputs.push({
      position: source.position,
      subject,
      messages: messages.map((message) => ({
        seq: BigInt(message.seq),
        body: message.body,
        // Review a2-IN-06: the role comes from the direction only, never from an author field.
        role: message.direction === "OUTBOUND" ? ("agent" as const) : ("customer" as const),
      })),
    });
  }
  return { inputs, snapshots };
}

/**
 * The ticket numbers, in position order, of the proposal's sources that lost eligibility or whose
 * largest PUBLIC seq is now greater than the stored snapshotSeq (a null snapshotSeq means no
 * PUBLIC message at generation, so any PUBLIC message now is a change). An INTERNAL note is never
 * a change. A source the organization can no longer read has no number and is not listed here
 * (recheckSourceEligibility reports it as NOT_FOUND).
 */
export async function findChangedSources(
  client: SourceQueryClient,
  orgId: string,
  proposalId: string,
): Promise<number[]> {
  const sources = await readStoredSources(client, orgId, proposalId);
  if (sources.length === 0) return [];
  const ids = sources.map((source) => source.ticketId);
  const verdicts = await evaluateTickets(client, orgId, ids);
  const largest = await readLargestPublicSeqs(client, orgId, ids);

  const changed: number[] = [];
  for (const source of sources) {
    const verdict = verdicts.get(source.ticketId);
    if (!verdict) continue;
    if (!verdict.eligible) {
      if (verdict.reason !== "NOT_FOUND") changed.push(verdict.number);
      continue;
    }
    const current = largest.get(source.ticketId);
    if (current === undefined) continue;
    const snapshot = source.snapshotSeq === null ? null : BigInt(source.snapshotSeq);
    if (snapshot === null || current > snapshot) changed.push(verdict.number);
  }
  return changed;
}
