// ---------------------------------------------------------------------------
// seedDemoData — orchestrates the full demo workspace write (07-02, AIDA-22).
//
// Bare `prisma` (not scopedDb) is used throughout: this is a script with no
// session to scope from, so every direct write carries an explicit
// `organizationId` instead of relying on scopedDb's runtime injection.
//
// Reuses the project's single write paths where they exist (createTicket,
// createKbArticle) and writes directly for models that have no dedicated
// helper (Tag, TicketTag, CustomFieldDefinition, CustomFieldValue,
// CsatResponse, InsightRun, member — see prisma/seed.ts for member creation).
//
// Deliberate exclusions:
//  - The AI-toggle Setting key is NEVER written. Leaving it unset keeps AI
//    off, which is what makes the demo honest and stops createTicket from
//    enqueuing ai-triage jobs for every seeded ticket.
//  - No `Attachment` rows are created. `localFileStorage` would try to
//    mkdir an absolute container path (/data/uploads) that does not exist
//    on a developer machine outside Docker — attachments are out of scope
//    for this seed.
//  - KB articles are left at their default `embeddingStatus: "PENDING"`.
//    Without an embedding provider configured this is TRUTHFUL — the
//    chunks genuinely are not embedded — never faked as "COMPLETED".
// ---------------------------------------------------------------------------
import type { TicketPriority } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  DEMO_CONTACTS,
  DEMO_CUSTOM_FIELDS,
  DEMO_KB_ARTICLES,
  DEMO_TAGS,
  DEMO_TICKETS,
  type DemoTicket,
} from "@/lib/demo/fixtures";
import { createKbArticle } from "@/lib/kb/create-article";
import { renderMarkdown } from "@/lib/markdown/render";
import { createTicket } from "@/lib/tickets/create-ticket";
import { computeDueTimestamps, DEFAULT_SLA_TARGETS } from "@/lib/tickets/sla";

/** All seeded AI artifacts (AuditEvent/InsightRun) use these — never a real vendor/model name. */
export const DEMO_ARTIFACT_PROVIDER = "demo";
export const DEMO_ARTIFACT_MODEL = "demo-seed";

const HOUR_MS = 3_600_000;
const PRIORITIES: TicketPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];

export interface SeedDemoDataOptions {
  orgId: string;
  adminUserId: string;
  agentUserId: string;
  /** injected so tests/CLI can pin "now"; defaults to new Date() */
  now?: Date;
}

export interface SeedDemoSummary {
  contacts: number;
  tags: number;
  customFields: number;
  kbArticles: number;
  tickets: number;
  messages: number;
  internalNotes: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  breached: number;
  atRiskOnly: number;
  unassigned: number;
  csatResponses: number;
  auditEvents: number;
  insightRuns: number;
}

/** One seeded ticket, kept around after the write loop — Task 3's Insight/audit
 * artifacts need real ids/numbers/subjects for citations, never string literals. */
interface SeededTicket {
  id: string;
  number: number;
  subject: string;
  spec: DemoTicket;
}

export async function seedDemoData(opts: SeedDemoDataOptions): Promise<SeedDemoSummary> {
  const { orgId, adminUserId, agentUserId } = opts;
  const now = opts.now ?? new Date();

  // --- 2. Baseline settings: SLA policies only. The AI-toggle Setting key is
  // intentionally never written (D-02/D-03) — SLA policies fall back to
  // DEFAULT_SLA_TARGETS when no SlaPolicy row exists, but we write explicit
  // rows so Settings > SLA Policies shows configured values, not silent
  // defaults. ---
  for (const priority of PRIORITIES) {
    const targets = DEFAULT_SLA_TARGETS[priority];
    await prisma.slaPolicy.create({
      data: {
        organizationId: orgId,
        priority,
        firstResponseTargetMinutes: targets.firstResponseMinutes,
        resolutionTargetMinutes: targets.resolutionMinutes,
      },
    });
  }

  // --- 3. Taxonomy: tags + custom field definitions. ---
  const tagIdByName = new Map<string, string>();
  for (const name of DEMO_TAGS) {
    const tag = await prisma.tag.create({ data: { organizationId: orgId, name } });
    tagIdByName.set(name, tag.id);
  }

  const cfIdByLabel = new Map<string, string>();
  const cfTypeByLabel = new Map<string, string>();
  for (const cf of DEMO_CUSTOM_FIELDS) {
    const definition = await prisma.customFieldDefinition.create({
      data: {
        organizationId: orgId,
        label: cf.label,
        type: cf.type,
        options: cf.options ?? undefined,
        position: cf.position,
      },
    });
    cfIdByLabel.set(cf.label, definition.id);
    cfTypeByLabel.set(cf.label, cf.type);
  }

  // --- 4. Tickets. ---
  const seededTickets: SeededTicket[] = [];
  const contactIdByEmail = new Map<string, string>();
  const earliestTicketCreatedAtByEmail = new Map<string, Date>();

  let messageCount = 0;
  let internalNoteCount = 0;

  for (const spec of DEMO_TICKETS) {
    const contact = DEMO_CONTACTS.find((c) => c.email === spec.contactEmail);
    if (!contact) {
      throw new Error(`[seed] fixtures.ts bug: no DEMO_CONTACTS entry for ${spec.contactEmail}`);
    }

    // 4a. The ONE ticket write path — createTicket always stamps createdAt = now();
    // historical timestamps are applied by the follow-up update below (4e).
    const created = await createTicket(orgId, {
      subject: spec.subject,
      priority: spec.priority,
      body: spec.body,
      contact: {
        email: contact.email,
        name: contact.name,
        company: contact.company,
        phone: contact.phone ?? null,
      },
      direction: "INBOUND",
    });
    messageCount += 1; // the initial inbound message created by createTicket

    // Resolve the (already-normalized) contact id for reply authorship (4i) and the
    // contacts-backdating pass (5) — createTicket's result doesn't carry it.
    let contactId = contactIdByEmail.get(contact.email);
    if (!contactId) {
      const contactRow = await prisma.contact.findFirst({
        where: { organizationId: orgId, email: contact.email },
      });
      if (!contactRow) {
        throw new Error(`[seed] contact lookup failed after createTicket for ${contact.email}`);
      }
      contactId = contactRow.id;
      contactIdByEmail.set(contact.email, contactId);
    }

    // 4b/4c. Backdated createdAt + SLA due timestamps recomputed from that backdated time.
    const createdAt = new Date(now.getTime() - spec.ageHours * HOUR_MS);
    const { firstResponseMinutes: frMin, resolutionMinutes: resMin } =
      DEFAULT_SLA_TARGETS[spec.priority];
    const { firstResponseDueAt, resolutionDueAt } = computeDueTimestamps(createdAt, frMin, resMin);

    // 4d. SLA flags — forced false on RESOLVED/CLOSED (the app clears them on resolve).
    const isResolvedLike = spec.status === "RESOLVED" || spec.status === "CLOSED";
    const isBreached = !isResolvedLike && spec.slaState === "breached";
    const isAtRisk =
      !isResolvedLike && (spec.slaState === "breached" || spec.slaState === "at-risk");

    const assigneeId =
      spec.assignee === "admin" ? adminUserId : spec.assignee === "agent" ? agentUserId : null;

    const firstRespondedAt =
      spec.firstResponseAfterHours !== null
        ? new Date(createdAt.getTime() + spec.firstResponseAfterHours * HOUR_MS)
        : null;
    const resolvedAt =
      spec.resolvedAfterHours !== null
        ? new Date(createdAt.getTime() + spec.resolvedAfterHours * HOUR_MS)
        : null;

    // updatedAt = timestamp of the ticket's last reply, else createdAt — the inbox sorts
    // by createdAt desc so this only affects the reading-pane "last updated" display.
    const lastReplyOffset = spec.replies.reduce((max, r) => Math.max(max, r.offsetHours), 0);
    const updatedAt =
      lastReplyOffset > 0 ? new Date(createdAt.getTime() + lastReplyOffset * HOUR_MS) : createdAt;

    // 4e. Single update applying every backdated/derived field.
    await prisma.ticket.update({
      where: { id: created.id },
      data: {
        createdAt,
        updatedAt,
        status: spec.status,
        assigneeId,
        firstResponseDueAt,
        resolutionDueAt,
        firstRespondedAt,
        resolvedAt,
        isAtRisk,
        isBreached,
        // Task 3 slots triageCategory / triageSentiment / triageLanguage / triageStatus
        // into this same update when spec.triage is non-null.
      },
    });

    // 4f. Backdate the initial inbound message to match the ticket's createdAt.
    await prisma.message.update({ where: { id: created.messageId }, data: { createdAt } });

    // 4g. Tags.
    for (const tagName of spec.tags) {
      const tagId = tagIdByName.get(tagName);
      if (!tagId) throw new Error(`[seed] fixtures.ts bug: unknown tag "${tagName}"`);
      await prisma.ticketTag.create({ data: { ticketId: created.id, tagId } });
    }

    // 4h. Custom field values — column picked by the definition's type.
    for (const field of spec.customFields ?? []) {
      const definitionId = cfIdByLabel.get(field.label);
      const type = cfTypeByLabel.get(field.label);
      if (!definitionId || !type) {
        throw new Error(`[seed] fixtures.ts bug: unknown custom field "${field.label}"`);
      }
      const valueData: Record<string, unknown> = {
        organizationId: orgId,
        ticketId: created.id,
        customFieldDefinitionId: definitionId,
      };
      if (type === "NUMBER") valueData.valueNumber = field.value;
      else if (type === "CHECKBOX") valueData.valueBoolean = field.value;
      else if (type === "DATE") valueData.valueDate = new Date(String(field.value));
      else valueData.valueText = String(field.value); // TEXT + SELECT

      await (
        prisma.customFieldValue.create as unknown as (a: {
          data: Record<string, unknown>;
        }) => Promise<{ id: string }>
      )({ data: valueData });
    }

    // 4i. Replies — the ONE Markdown->HTML authority (renderMarkdown), never raw HTML.
    for (const reply of spec.replies) {
      const replyCreatedAt = new Date(createdAt.getTime() + reply.offsetHours * HOUR_MS);
      const direction = reply.author === "contact" ? "INBOUND" : "OUTBOUND";
      const authorUserId =
        reply.author === "admin" ? adminUserId : reply.author === "agent" ? agentUserId : null;
      const authorContactId = reply.author === "contact" ? contactId : null;

      await (
        prisma.message.create as unknown as (a: {
          data: Record<string, unknown>;
        }) => Promise<{ id: string }>
      )({
        data: {
          organizationId: orgId,
          ticketId: created.id,
          direction,
          visibility: reply.visibility,
          authorUserId,
          authorContactId,
          bodyMarkdown: reply.body,
          bodyHtml: renderMarkdown(reply.body),
          createdAt: replyCreatedAt,
        },
      });
      messageCount += 1;
      if (reply.visibility === "INTERNAL") internalNoteCount += 1;
    }

    // 4j. Keep the real id/number/subject around for Task 3's citations.
    seededTickets.push({ id: created.id, number: created.number, subject: spec.subject, spec });

    const prevEarliest = earliestTicketCreatedAtByEmail.get(contact.email);
    if (!prevEarliest || createdAt < prevEarliest) {
      earliestTicketCreatedAtByEmail.set(contact.email, createdAt);
    }
  }

  // --- 5. Contacts backdating: no contact should look newer than their first ticket. ---
  for (const [email, earliest] of earliestTicketCreatedAtByEmail) {
    const contactId = contactIdByEmail.get(email);
    if (!contactId) continue;
    await prisma.contact.update({
      where: { id: contactId },
      data: { createdAt: new Date(earliest.getTime() - 24 * HOUR_MS) },
    });
  }

  // --- 6. KB articles — the ONE KB write path; embeddingStatus stays PENDING (truthful:
  // no embedding provider is configured in this demo, so nothing is actually embedded). ---
  for (const article of DEMO_KB_ARTICLES) {
    await createKbArticle(orgId, article);
  }

  // --- 7. No Attachment rows are ever created here — see file header. ---

  // --- 8. Summary (AI counters filled in by Task 3). ---
  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  for (const t of DEMO_TICKETS) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
  }
  const breached = DEMO_TICKETS.filter((t) => t.slaState === "breached").length;
  const atRiskOnly = DEMO_TICKETS.filter((t) => t.slaState === "at-risk").length;
  const unassigned = DEMO_TICKETS.filter((t) => t.assignee === null).length;

  return {
    contacts: DEMO_CONTACTS.length,
    tags: DEMO_TAGS.length,
    customFields: DEMO_CUSTOM_FIELDS.length,
    kbArticles: DEMO_KB_ARTICLES.length,
    tickets: DEMO_TICKETS.length,
    messages: messageCount,
    internalNotes: internalNoteCount,
    byStatus,
    byPriority,
    breached,
    atRiskOnly,
    unassigned,
    csatResponses: 0, // Task 3
    auditEvents: 0, // Task 3
    insightRuns: 0, // Task 3
  };
}
