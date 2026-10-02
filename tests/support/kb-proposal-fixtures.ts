// Test-only seed helpers shared by every Phase 12.2 (KB proposals) test. Relative imports only.
// Each call creates fresh, uniquely named rows so cases stay independent. The proposal rows are
// inserted directly (no service rules beyond the database's own CHECKs and foreign keys); the
// status fence trigger fires on UPDATE only, so a fixture may insert any status.
//
// Message seqs (review P1): Message.seq is a database-wide BigInt sequence. A message seeded
// without an explicit seq takes the sequence's next value; an explicit seq bypasses the sequence,
// so a test that passes one should put every message of that ticket on explicit seqs. Seqs stay
// bigint end to end here: never convert one with Number().
import { randomUUID } from "node:crypto";
import type {
  KbProposalFailureCode,
  KbProposalStatus,
  MessageDirection,
  MessageVisibility,
} from "../../src/generated/prisma/client";
import { prisma as globalPrisma } from "../../src/lib/db";
import { type LegacyStatusKey, type SeedTicketOverrides, seedTicket } from "./inbox-fixtures";

export { seedOrgWithMembers, seedTicket, stateIdFor } from "./inbox-fixtures";
export type { LegacyStatusKey };

/**
 * Creates a ticket through seedTicket in a RESOLVED-group state by default. Any legacy key
 * (CLOSED, OPEN, PENDING, NEW) or an explicit stateId of the same organization may be given.
 */
export async function seedResolvedTicket(
  orgId: string,
  overrides: SeedTicketOverrides = {},
): Promise<{ id: string; number: number }> {
  const status = overrides.stateId === undefined ? (overrides.status ?? "RESOLVED") : undefined;
  return seedTicket(orgId, { ...overrides, ...(status ? { status } : {}) });
}

export interface SeedMessageOpts {
  /** Explicit seq; when absent the database sequence draws the next one. */
  seq?: bigint;
  direction?: MessageDirection;
  createdAt?: Date;
}

export interface SeededProposalMessage {
  id: string;
  seq: bigint;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function seedMessageWithVisibility(
  orgId: string,
  ticketId: string,
  body: string,
  visibility: MessageVisibility,
  opts: SeedMessageOpts,
): Promise<SeededProposalMessage> {
  return globalPrisma.message.create({
    data: {
      organizationId: orgId,
      ticketId,
      direction: opts.direction ?? (visibility === "INTERNAL" ? "OUTBOUND" : "INBOUND"),
      visibility,
      bodyMarkdown: body,
      bodyHtml: `<p>${escapeHtml(body)}</p>`,
      ...(opts.seq !== undefined ? { seq: opts.seq } : {}),
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
    select: { id: true, seq: true },
  });
}

/** Inserts one PUBLIC message (the only visibility generation may read, D-10). */
export async function seedPublicMessage(
  orgId: string,
  ticketId: string,
  body: string,
  opts: { seq?: bigint } & SeedMessageOpts = {},
): Promise<SeededProposalMessage> {
  return seedMessageWithVisibility(orgId, ticketId, body, "PUBLIC", opts);
}

/** Inserts one INTERNAL note (never sent to the model, D-10). */
export async function seedInternalNote(
  orgId: string,
  ticketId: string,
  body: string,
  opts: { seq?: bigint } & SeedMessageOpts = {},
): Promise<SeededProposalMessage> {
  return seedMessageWithVisibility(orgId, ticketId, body, "INTERNAL", opts);
}

export interface SeedProposalOptions {
  status: KbProposalStatus;
  /** Source tickets of the same organization, stored with positions 1 to n. */
  ticketIds: readonly string[];
  title?: string | null;
  bodyMarkdown?: string | null;
  version?: number;
  generationEpoch?: number;
  requestedByUserId?: string;
  generationQueuedAt?: Date;
  generationClaimedAt?: Date | null;
  generatedAt?: Date | null;
  inputTruncated?: boolean;
  failureCode?: KbProposalFailureCode;
  failedAt?: Date | null;
  rejectedByUserId?: string;
  rejectedAt?: Date;
  publishedByUserId?: string;
  publishedAt?: Date;
  lastEditedByUserId?: string | null;
  lastEditedAt?: Date | null;
  createdAt?: Date;
  /** Per-source snapshot seq, by position (index 0 is position 1); null or absent leaves it null. */
  snapshotSeqs?: readonly (bigint | null)[];
  /** Per-source cited section labels, by position. */
  citedSections?: readonly (readonly string[])[];
}

export interface SeededProposal {
  id: string;
  publishedArticleId: string | null;
}

/**
 * Inserts one KbProposal that satisfies the CHECKs for the requested status, and its sources.
 * DRAFT, REJECTED and PUBLISHED get a default title and body; FAILED gets failureCode UNKNOWN
 * unless one is given; REJECTED gets reviewer columns; PUBLISHED creates its KbArticle directly
 * (embeddingStatus PENDING, no chunk) and links it.
 */
export async function seedProposal(
  orgId: string,
  options: SeedProposalOptions,
): Promise<SeededProposal> {
  const tag = randomUUID();
  const now = new Date();
  const status = options.status;
  const needsText = status === "DRAFT" || status === "REJECTED" || status === "PUBLISHED";
  const title =
    options.title !== undefined ? options.title : needsText ? `Proposal ${tag.slice(0, 8)}` : null;
  const bodyMarkdown =
    options.bodyMarkdown !== undefined
      ? options.bodyMarkdown
      : needsText
        ? `Fixture proposal body ${tag}`
        : null;
  const requestedByUserId = options.requestedByUserId ?? randomUUID();

  let publishedArticleId: string | null = null;
  if (status === "PUBLISHED") {
    const article = await globalPrisma.kbArticle.create({
      data: {
        organizationId: orgId,
        title: title ?? `Proposal ${tag.slice(0, 8)}`,
        slug: `proposal-${tag}`,
        bodyMarkdown: bodyMarkdown ?? "",
        bodyHtml: `<p>${escapeHtml(bodyMarkdown ?? "")}</p>`,
      },
      select: { id: true },
    });
    publishedArticleId = article.id;
  }

  const proposal = await globalPrisma.kbProposal.create({
    data: {
      organizationId: orgId,
      status,
      title,
      bodyMarkdown,
      requestedByUserId,
      ...(options.version !== undefined ? { version: options.version } : {}),
      ...(options.generationEpoch !== undefined
        ? { generationEpoch: options.generationEpoch }
        : {}),
      ...(options.generationQueuedAt ? { generationQueuedAt: options.generationQueuedAt } : {}),
      ...(options.generationClaimedAt !== undefined
        ? { generationClaimedAt: options.generationClaimedAt }
        : {}),
      generatedAt:
        options.generatedAt !== undefined
          ? options.generatedAt
          : status === "GENERATING"
            ? null
            : now,
      inputTruncated: options.inputTruncated ?? false,
      failureCode: status === "FAILED" ? (options.failureCode ?? "UNKNOWN") : null,
      failedAt:
        options.failedAt !== undefined ? options.failedAt : status === "FAILED" ? now : null,
      rejectedByUserId: status === "REJECTED" ? (options.rejectedByUserId ?? randomUUID()) : null,
      rejectedAt: status === "REJECTED" ? (options.rejectedAt ?? now) : null,
      publishedByUserId:
        status === "PUBLISHED" ? (options.publishedByUserId ?? randomUUID()) : null,
      publishedAt: status === "PUBLISHED" ? (options.publishedAt ?? now) : null,
      publishedArticleId,
      lastEditedByUserId: options.lastEditedByUserId ?? null,
      lastEditedAt: options.lastEditedAt ?? null,
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    },
    select: { id: true },
  });

  for (const [index, ticketId] of options.ticketIds.entries()) {
    await globalPrisma.kbProposalSource.create({
      data: {
        organizationId: orgId,
        proposalId: proposal.id,
        ticketId,
        position: index + 1,
        snapshotSeq: options.snapshotSeqs?.[index] ?? null,
        citedSections: [...(options.citedSections?.[index] ?? [])],
      },
    });
  }

  return { id: proposal.id, publishedArticleId };
}
