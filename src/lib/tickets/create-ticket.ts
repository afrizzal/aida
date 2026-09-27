import type { MessageDirection, Prisma, TicketPriority } from "@/generated/prisma/client";
import { findOrCreateContact } from "@/lib/contacts/find-or-create-contact";
import { renderMarkdown } from "@/lib/markdown/render";
import { getBoss } from "@/lib/queue/boss-client";
import { scopedDb } from "@/lib/scoped-db";
import { computeDueTimestamps, getSlaTargets } from "@/lib/tickets/sla";
import { generateStatusToken } from "@/lib/tickets/status-token";
import { readStateConfigForShare, shareLockActiveState } from "@/lib/tickets/ticket-states";

export type CreateTicketInput = {
  subject: string;
  priority: TicketPriority;
  body: string;
  /** Pre-rendered/sanitized HTML body (email ingest); falls back to renderMarkdown(body) when omitted. */
  bodyHtml?: string | null;
  contact: {
    email: string;
    name?: string | null;
    phone?: string | null;
    company?: string | null;
  };
  direction: MessageDirection;
  authorUserId?: string | null;
  /** Email identity fields (D-08) — carried through only when the ticket originates from inbound email. */
  emailMessageId?: string | null;
  emailInReplyTo?: string | null;
  emailReferences?: string[];
};

export type CreateTicketResult = {
  id: string;
  number: number;
  statusToken: string;
  messageId: string;
};

/**
 * Thrown inside the create transaction when the organization's default state (newStateId) is
 * missing or soft-deleted, so nothing is created. Under the config share lock the admin protocol
 * cannot cause it; it guards against a writer that locks the state without the config.
 */
export class DefaultStateUnavailableError extends Error {
  constructor(orgId: string) {
    super(`The default ticket state of organization ${orgId} is not available`);
    this.name = "DefaultStateUnavailableError";
  }
}

/** Test-only hooks into the create transaction (race proofs, review C7). */
export interface CreateTicketObserver {
  /** Awaited as the very first statement of the transaction, before any lock. */
  onTransactionStart?(tx: Prisma.TransactionClient): Promise<void> | void;
  /** Awaited right after the config and default-state share locks. */
  afterStateLocks?(tx: Prisma.TransactionClient): Promise<void> | void;
}

let createTicketObserver: CreateTicketObserver | null = null;

/**
 * Test seam only (as setStatusReadObserverForTests): lets a race test record the backend PID
 * and hold the share locks of a create. Production never sets it.
 */
export function setCreateTicketObserverForTests(observer: CreateTicketObserver | null): void {
  createTicketObserver = observer;
}

// single-org v1: callers resolve orgId; public intake uses organization.findFirstOrThrow (plan 11).
/**
 * The ONE code path that creates tickets — reused by the agent "New Ticket" flow and the
 * public web form. Atomically: links/creates a Contact by normalized email, increments the
 * per-org ticket counter, stamps SLA due timestamps from priority, and stores a sanitized
 * initial Message — all inside a single transaction. The ticket starts in the organization's
 * default state (TicketStateConfig.newStateId, D-11), read under the role-writer locks.
 */
export async function createTicket(
  orgId: string,
  input: CreateTicketInput,
): Promise<CreateTicketResult> {
  const db = scopedDb(orgId);

  const result = await db.$transaction(async (tx) => {
    if (createTicketObserver?.onTransactionStart) await createTicketObserver.onTransactionStart(tx);
    // Role-writer lock order (D-15 amended, review C7): the configuration row FOR SHARE, then the
    // default state FOR SHARE, before the contact, the counter and the ticket.
    const config = await readStateConfigForShare(tx, orgId);
    const defaultState = await shareLockActiveState(tx, orgId, config.newStateId);
    if (!defaultState) throw new DefaultStateUnavailableError(orgId);
    if (createTicketObserver?.afterStateLocks) await createTicketObserver.afterStateLocks(tx);

    const contact = await findOrCreateContact(tx, input.contact);

    const counter = await (
      tx.ticketCounter.upsert as (a: {
        where: { organizationId: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => Promise<{ lastNumber: number }>
    )({
      where: { organizationId: orgId },
      create: { lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });

    const now = new Date();
    const targets = await getSlaTargets(tx, input.priority);
    const { firstResponseDueAt, resolutionDueAt } = computeDueTimestamps(
      now,
      targets.firstResponseMinutes,
      targets.resolutionMinutes,
    );

    // scopedDb's create hook injects organizationId at runtime; Prisma's generated
    // *UncheckedCreateInput types require it statically (same cast pattern as
    // ticketCounter.upsert above and tests/integration/scoped-tx.test.ts).
    const ticket = await (
      tx.ticket.create as (a: {
        data: Record<string, unknown>;
      }) => Promise<{ id: string; number: number; statusToken: string }>
    )({
      data: {
        number: counter.lastNumber,
        statusToken: generateStatusToken(),
        subject: input.subject,
        stateId: config.newStateId,
        priority: input.priority,
        contactId: contact.id,
        firstResponseTargetMinutes: targets.firstResponseMinutes,
        resolutionTargetMinutes: targets.resolutionMinutes,
        firstResponseDueAt,
        resolutionDueAt,
      },
    });

    const message = await (
      tx.message.create as (a: { data: Record<string, unknown> }) => Promise<{ id: string }>
    )({
      data: {
        ticketId: ticket.id,
        direction: input.direction,
        visibility: "PUBLIC",
        authorContactId: input.direction === "INBOUND" ? contact.id : null,
        authorUserId: input.authorUserId ?? null,
        bodyMarkdown: input.body,
        bodyHtml: input.bodyHtml ?? renderMarkdown(input.body),
        emailMessageId: input.emailMessageId ?? null,
        emailInReplyTo: input.emailInReplyTo ?? null,
        emailReferences: input.emailReferences ?? [],
      },
    });

    return {
      id: ticket.id,
      number: ticket.number,
      statusToken: ticket.statusToken,
      messageId: message.id,
    };
  });

  // Auto-triage (D-06/D-07/D-20). Enqueued AFTER commit — pg-boss send must NEVER live inside
  // the Prisma transaction; gated on the aiEnabled kill switch. A no-op when AI is off — the
  // ticket still appears in the inbox regardless (D-10). When this runs inside the worker
  // (email ingest), getBoss() lazily creates a lightweight app-style pg-boss client used only
  // for send() — acceptable (send is a DB insert; createQueue is idempotent).
  const aiSetting = await db.setting.findFirst({ where: { key: "aiEnabled" } });
  if (aiSetting?.value === "true") {
    await db.ticket.update({ where: { id: result.id }, data: { triageStatus: "PENDING" } });
    const boss = await getBoss();
    await boss.send("ai-triage", { ticketId: result.id });
  }

  return result;
}
