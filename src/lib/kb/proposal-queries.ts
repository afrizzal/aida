// KB proposal loaders (Phase 12.2, AIDA-18, plan 12.2-08): the reads behind /kb/proposals, the
// review page /kb/proposals/[id] and the Start dialog. D-01 first: every loader reads the actor's
// member rows through findConservativeMembership (run decision K59: every row of the user in the
// organization, admin only when every row is owner or admin) and requires the exact owner or
// admin role (isAdminRole) before any proposal or ticket query, and a refusal carries no data.
//
//   * loadProposalList: every proposal of the organization, newest first, as list rows.
//   * loadProposalReview: one proposal for the review page. A missing id and another
//     organization's id both give NOT_FOUND (T-12.2-36). Changed sources are ticket numbers from
//     findChangedSources (D-08, review P1); isStuck counts from generationClaimedAt, else
//     generationQueuedAt (review C5); a published proposal carries its article's embeddingStatus
//     as stored, PENDING, FAILED or COMPLETED (review C2).
//   * loadStartSelection: number, subject and state chip data of the organization's tickets
//     among the given ids, in the given order; another organization's ticket is omitted.
//
// Review P3: every read names its fields in an explicit select (never an include of a relation,
// never a whole Ticket or KbProposalSource row), and each result is built field by field from
// those selects. The sources' snapshot marker and Ticket's BigInt columns are never read here,
// so no result carries a bigint.
//
// Display names (requester, reviewer, publisher) come from the user table by id; a user row that
// no longer exists gives null and the page omits the name.
//
// Relative imports only and no Next.js import: the server actions and pages call these.
import type { KbEmbeddingStatus, KbProposalFailureCode } from "../../generated/prisma/client";
import { prisma } from "../db";
import { findConservativeMembership, isAdminRole } from "../membership";
import { scopedDb } from "../scoped-db";
import { isStuck, MAX_PROPOSAL_SOURCES, type ProposalStatus } from "./proposal-contract";
import { findChangedSources } from "./proposal-sources";

export interface ProposalQueryActor {
  userId: string;
  orgId: string;
}

/** A loader refusal; it carries no proposal, row or ticket data (D-01, T-12.2-35). */
export type AccessRefusal = { kind: "NOT_ALLOWED" } | { kind: "MEMBERSHIP_ENDED" };

export type NotFound = { kind: "NOT_FOUND" };

// --- List -----------------------------------------------------------------------------------------

export interface ProposalListRow {
  id: string;
  status: ProposalStatus;
  /** Null while GENERATING (and for a FAILED proposal that never drafted). */
  title: string | null;
  failureCode: KbProposalFailureCode | null;
  sourceCount: number;
  createdAt: Date;
}

export type ProposalListResult =
  | { kind: "ok"; aiEnabled: boolean; rows: ProposalListRow[] }
  | AccessRefusal;

// --- Review ---------------------------------------------------------------------------------------

export interface ProposalReviewTicket {
  number: number;
  subject: string;
  stateName: string;
  colorToken: string;
}

export interface ProposalReviewSource {
  ticketId: string;
  position: number;
  citedSections: string[];
  /** True when the organization can no longer read the ticket; `ticket` is then null. */
  unavailable: boolean;
  ticket: ProposalReviewTicket | null;
  /** True when the ticket's number is among changedSourceNumbers (D-08). */
  changed: boolean;
}

export interface ProposalReviewData {
  id: string;
  status: ProposalStatus;
  version: number;
  title: string | null;
  bodyMarkdown: string | null;
  inputTruncated: boolean;
  failureCode: KbProposalFailureCode | null;
  createdAt: Date;
  generatedAt: Date | null;
  requestedByName: string | null;
  rejectedByName: string | null;
  rejectedAt: Date | null;
  publishedByName: string | null;
  publishedAt: Date | null;
  /** In position order. */
  sources: ProposalReviewSource[];
  /** Ticket numbers of the sources changed since generation (review P1: numbers only). */
  changedSourceNumbers: number[];
  aiEnabled: boolean;
  /** isStuck(proposal, now) of proposal-contract.ts (review C5). */
  stuck: boolean;
  /** Set when PUBLISHED: the article and its embedding status as stored (review C2). */
  article: { id: string; embeddingStatus: KbEmbeddingStatus } | null;
}

export type ProposalReviewResult =
  | { kind: "ok"; proposal: ProposalReviewData }
  | AccessRefusal
  | NotFound;

export interface ProposalReviewQueryOptions {
  /** The page's clock for isStuck (tests inject it); defaults to the current time. */
  now?: Date;
}

// --- Start selection ------------------------------------------------------------------------------

export interface StartSelectionTicket {
  id: string;
  number: number;
  subject: string;
  stateName: string;
  colorToken: string;
  /** Set for a merged source: the ticket it was merged into, so its refusal can link to it. */
  mergedInto: { id: string; number: number } | null;
}

export type StartSelectionResult = { kind: "ok"; tickets: StartSelectionTicket[] } | AccessRefusal;

// --- Shared ---------------------------------------------------------------------------------------

/** D-01, K59: the member rows, then the exact owner or admin role. Before any proposal query. */
async function checkAdmin(actor: ProposalQueryActor): Promise<AccessRefusal | null> {
  const { userId, orgId } = actor;
  if (!userId || !orgId) return { kind: "MEMBERSHIP_ENDED" };
  const membership = await findConservativeMembership(prisma, userId, orgId);
  if (!membership) return { kind: "MEMBERSHIP_ENDED" };
  if (!isAdminRole(membership.role)) return { kind: "NOT_ALLOWED" };
  return null;
}

type ScopedClient = ReturnType<typeof scopedDb>;

/** aiEnabled is on only when its setting is exactly 'true' (the request's own rule, D-09). */
async function readAiEnabled(db: ScopedClient, orgId: string): Promise<boolean> {
  const setting = await db.setting.findFirst({
    where: { organizationId: orgId, key: "aiEnabled" },
    select: { value: true },
  });
  return setting?.value === "true";
}

/** Display names by user id; a user id without a row is absent from the map. */
async function readUserNames(ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const wanted = [
    ...new Set(ids.filter((id): id is string => typeof id === "string" && id !== "")),
  ];
  if (wanted.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: wanted } },
    select: { id: true, name: true },
  });
  return new Map(users.map((user) => [user.id, user.name]));
}

function nameOf(names: Map<string, string>, id: string | null): string | null {
  if (!id) return null;
  return names.get(id) ?? null;
}

/** Statuses whose sources carry a stored snapshot; only these are compared (D-08). */
const SNAPSHOT_STATUSES: ReadonlySet<ProposalStatus> = new Set(["DRAFT", "REJECTED", "PUBLISHED"]);

// --- Loaders --------------------------------------------------------------------------------------

/** Every proposal of the actor's organization, newest first (UI-SPEC Surface 2). */
export async function loadProposalList(actor: ProposalQueryActor): Promise<ProposalListResult> {
  const refusal = await checkAdmin(actor);
  if (refusal) return refusal;
  const { orgId } = actor;
  const db = scopedDb(orgId);

  const proposals = await db.kbProposal.findMany({
    where: { organizationId: orgId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      status: true,
      title: true,
      failureCode: true,
      createdAt: true,
      _count: { select: { sources: true } },
    },
  });
  const aiEnabled = await readAiEnabled(db, orgId);

  const rows: ProposalListRow[] = proposals.map((proposal) => ({
    id: proposal.id,
    status: proposal.status,
    title: proposal.title,
    failureCode: proposal.failureCode,
    sourceCount: proposal._count.sources,
    createdAt: proposal.createdAt,
  }));
  return { kind: "ok", aiEnabled, rows };
}

/** One proposal for the review page (UI-SPEC Surface 3, D-08, D-15). */
export async function loadProposalReview(
  actor: ProposalQueryActor,
  id: string,
  opts: ProposalReviewQueryOptions = {},
): Promise<ProposalReviewResult> {
  const refusal = await checkAdmin(actor);
  if (refusal) return refusal;
  const { orgId } = actor;
  const proposalId = typeof id === "string" ? id : "";
  if (proposalId === "") return { kind: "NOT_FOUND" };
  const now = opts.now ?? new Date();
  const db = scopedDb(orgId);

  const proposal = await db.kbProposal.findFirst({
    where: { id: proposalId, organizationId: orgId },
    select: {
      id: true,
      status: true,
      version: true,
      title: true,
      bodyMarkdown: true,
      inputTruncated: true,
      failureCode: true,
      createdAt: true,
      generatedAt: true,
      generationQueuedAt: true,
      generationClaimedAt: true,
      requestedByUserId: true,
      rejectedByUserId: true,
      rejectedAt: true,
      publishedByUserId: true,
      publishedAt: true,
      publishedArticleId: true,
    },
  });
  if (!proposal) return { kind: "NOT_FOUND" };

  const sourceRows = await db.kbProposalSource.findMany({
    where: { proposalId: proposal.id, organizationId: orgId },
    orderBy: { position: "asc" },
    select: { ticketId: true, position: true, citedSections: true },
  });
  const ticketRows =
    sourceRows.length === 0
      ? []
      : await db.ticket.findMany({
          where: { id: { in: sourceRows.map((source) => source.ticketId) }, organizationId: orgId },
          select: {
            id: true,
            number: true,
            subject: true,
            state: { select: { name: true, colorToken: true } },
          },
        });
  const tickets = new Map(
    ticketRows.map((ticket) => [
      ticket.id,
      {
        number: ticket.number,
        subject: ticket.subject,
        stateName: ticket.state.name,
        colorToken: ticket.state.colorToken,
      } satisfies ProposalReviewTicket,
    ]),
  );

  const changedSourceNumbers = SNAPSHOT_STATUSES.has(proposal.status)
    ? await findChangedSources(db, orgId, proposal.id)
    : [];
  const changed = new Set(changedSourceNumbers);

  const sources: ProposalReviewSource[] = sourceRows.map((source) => {
    const ticket = tickets.get(source.ticketId) ?? null;
    return {
      ticketId: source.ticketId,
      position: source.position,
      citedSections: [...source.citedSections],
      unavailable: ticket === null,
      ticket,
      changed: ticket !== null && changed.has(ticket.number),
    };
  });

  const names = await readUserNames([
    proposal.requestedByUserId,
    proposal.rejectedByUserId,
    proposal.publishedByUserId,
  ]);
  const aiEnabled = await readAiEnabled(db, orgId);

  let article: ProposalReviewData["article"] = null;
  if (proposal.publishedArticleId) {
    const row = await db.kbArticle.findFirst({
      where: { id: proposal.publishedArticleId, organizationId: orgId },
      select: { id: true, embeddingStatus: true },
    });
    article = row ? { id: row.id, embeddingStatus: row.embeddingStatus } : null;
  }

  return {
    kind: "ok",
    proposal: {
      id: proposal.id,
      status: proposal.status,
      version: proposal.version,
      title: proposal.title,
      bodyMarkdown: proposal.bodyMarkdown,
      inputTruncated: proposal.inputTruncated,
      failureCode: proposal.failureCode,
      createdAt: proposal.createdAt,
      generatedAt: proposal.generatedAt,
      requestedByName: nameOf(names, proposal.requestedByUserId),
      rejectedByName: nameOf(names, proposal.rejectedByUserId),
      rejectedAt: proposal.rejectedAt,
      publishedByName: nameOf(names, proposal.publishedByUserId),
      publishedAt: proposal.publishedAt,
      sources,
      changedSourceNumbers,
      aiEnabled,
      stuck: isStuck(
        {
          status: proposal.status,
          generationClaimedAt: proposal.generationClaimedAt,
          generationQueuedAt: proposal.generationQueuedAt,
        },
        now,
      ),
      article,
    },
  };
}

/**
 * The tickets the Start dialog lists (UI-SPEC 1b): the organization's tickets among the first
 * MAX_PROPOSAL_SOURCES distinct string ids, in the given order. Another organization's id and an
 * unknown id are omitted. Eligibility is judged by the request, not here.
 */
export async function loadStartSelection(
  actor: ProposalQueryActor,
  ticketIds: readonly string[],
): Promise<StartSelectionResult> {
  const refusal = await checkAdmin(actor);
  if (refusal) return refusal;
  const { orgId } = actor;

  const raw: readonly unknown[] = Array.isArray(ticketIds) ? ticketIds : [];
  const ids = [
    ...new Set(raw.filter((id): id is string => typeof id === "string" && id !== "")),
  ].slice(0, MAX_PROPOSAL_SOURCES);
  if (ids.length === 0) return { kind: "ok", tickets: [] };

  const rows = await scopedDb(orgId).ticket.findMany({
    where: { id: { in: ids }, organizationId: orgId },
    select: {
      id: true,
      number: true,
      subject: true,
      state: { select: { name: true, colorToken: true } },
      mergedInto: { select: { id: true, number: true, organizationId: true } },
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));

  const tickets: StartSelectionTicket[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;
    const target = row.mergedInto;
    tickets.push({
      id: row.id,
      number: row.number,
      subject: row.subject,
      stateName: row.state.name,
      colorToken: row.state.colorToken,
      mergedInto:
        target && target.organizationId === orgId ? { id: target.id, number: target.number } : null,
    });
  }
  return { kind: "ok", tickets };
}
