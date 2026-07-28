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
import type { Prisma, TicketPriority } from "@/generated/prisma/client";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { prisma } from "@/lib/db";
import {
  DEMO_CONTACTS,
  DEMO_CUSTOM_FIELDS,
  DEMO_KB_ARTICLES,
  DEMO_TAGS,
  DEMO_TICKETS,
  type DemoTicket,
} from "@/lib/demo/fixtures";
import type {
  InsightRunParams,
  SlaCsatSummary,
  StoredCluster,
  StoredKbGap,
  StoredNarrative,
  VolumeDriverRow,
  VolumeDrivers,
} from "@/lib/insight/types";
import { createKbArticle } from "@/lib/kb/create-article";
import { renderMarkdown } from "@/lib/markdown/render";
import { scopedDb } from "@/lib/scoped-db";
import { createTicket } from "@/lib/tickets/create-ticket";
import { computeDueTimestamps, DEFAULT_SLA_TARGETS } from "@/lib/tickets/sla";

/** All seeded AI artifacts (AuditEvent/InsightRun) use these — never a real vendor/model name.
 * Every artifact below is PRE-COMPUTED DATA, not the output of a live model call — provider/model
 * are deliberately "demo"/"demo-seed" so the UI can never imply a real vendor call happened. Live
 * AI actions (Generate draft, Generate insights, Re-run triage) still require a configured provider. */
export const DEMO_ARTIFACT_PROVIDER = "demo";
export const DEMO_ARTIFACT_MODEL = "demo-seed";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const PRIORITIES: TicketPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];

/** Recurring themes used to synthesize Insight clusters/gaps/volume drivers from the real
 * seeded tag data — never invented categories the seed doesn't actually contain. */
const INSIGHT_THEMES: { label: string; description: string; tag: string; kbTitle?: string }[] = [
  {
    label: "Password reset failures",
    description: "Customers reporting reset emails that never arrive or expire too quickly.",
    tag: "password-reset",
    kbTitle: "Resetting your password",
  },
  {
    label: "Invoice and billing questions",
    description: "Billing-cycle, seat-count, and duplicate-charge questions tied to invoices.",
    tag: "billing",
    kbTitle: "Understanding your invoice and billing cycle",
  },
  {
    label: "Integration disconnects",
    description: "Slack and webhook integrations dropping events or failing to sync.",
    tag: "integration",
    kbTitle: "Connecting the Slack integration",
  },
  {
    label: "Data export issues",
    description: "CSV/API export requests that are missing columns, erroring, or duplicating rows.",
    tag: "data-export",
    kbTitle: "Exporting your data (CSV and API)",
  },
  {
    label: "Feature requests",
    description: "Suggestions and enhancement requests raised directly by customers.",
    tag: "feature-request",
    // Deliberately no kbTitle — feature requests have no matching KB article in this seed,
    // which is exactly the genuine gap this theme is meant to surface.
  },
];

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** One key per ticket (triage category / company) — used for byCategory and byCompany rows. */
function computeVolumeRows(
  current: SeededTicket[],
  previous: SeededTicket[],
  keyFn: (t: SeededTicket) => string | null,
): VolumeDriverRow[] {
  const countBy = (list: SeededTicket[]) => {
    const m = new Map<string, number>();
    for (const t of list) {
      const key = keyFn(t);
      if (!key) continue;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  };
  const currentCounts = countBy(current);
  const previousCounts = countBy(previous);
  return Array.from(currentCounts.entries())
    .map(([key, count]) => {
      const previousCount = previousCounts.get(key) ?? 0;
      return { key, count, previousCount, delta: count - previousCount };
    })
    .sort((a, b) => b.count - a.count);
}

/** Many-keys-per-ticket variant (a ticket can carry multiple tags) — used for byTag rows. */
function computeTagVolumeRows(
  current: SeededTicket[],
  previous: SeededTicket[],
): VolumeDriverRow[] {
  const countBy = (list: SeededTicket[]) => {
    const m = new Map<string, number>();
    for (const t of list) {
      for (const tag of t.spec.tags) m.set(tag, (m.get(tag) ?? 0) + 1);
    }
    return m;
  };
  const currentCounts = countBy(current);
  const previousCounts = countBy(previous);
  return Array.from(currentCounts.entries())
    .map(([key, count]) => {
      const previousCount = previousCounts.get(key) ?? 0;
      return { key, count, previousCount, delta: count - previousCount };
    })
    .sort((a, b) => b.count - a.count);
}

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

/** One seeded ticket, kept around after the write loop — the Insight/audit artifacts below
 * need real ids/numbers/subjects for citations, never string literals. */
interface SeededTicket {
  id: string;
  number: number;
  subject: string;
  spec: DemoTicket;
  createdAt: Date;
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
  let auditEventCount = 0;
  // First PUBLIC admin/agent reply's messageId per ticket -- the draft-lifecycle audit rows
  // below reference these as "the message that resulted from the approved draft".
  const firstPublicAgentMessageIdByTicketId = new Map<string, string>();

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

    // 4e. Single update applying every backdated/derived field, including triage columns
    // (left null on every column when spec.triage is null -- "never triaged, AI was off").
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
        ...(spec.triage
          ? {
              triageCategory: spec.triage.category,
              triageSentiment: spec.triage.sentiment,
              triageLanguage: spec.triage.language,
              triageStatus: spec.triage.status,
            }
          : {}),
      },
    });

    // One TRIAGE AuditEvent per COMPLETED triage (D-13 shape: category/priority/sentiment/
    // language keys, matching what the AI Activity section renders for a TRIAGE event).
    if (spec.triage?.status === "COMPLETED") {
      await recordAuditEvent(scopedDb(orgId), {
        actionType: "TRIAGE",
        ticketId: created.id,
        provider: DEMO_ARTIFACT_PROVIDER,
        model: DEMO_ARTIFACT_MODEL,
        input: `[demo seed] redacted triage prompt for ticket #${created.number}`,
        output: JSON.stringify({
          category: spec.triage.category,
          priority: spec.priority,
          sentiment: spec.triage.sentiment,
          language: spec.triage.language,
        }),
      });
      auditEventCount += 1;
    }

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

      const createdReply = await (
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
      if (
        reply.visibility === "PUBLIC" &&
        (reply.author === "admin" || reply.author === "agent") &&
        !firstPublicAgentMessageIdByTicketId.has(created.id)
      ) {
        firstPublicAgentMessageIdByTicketId.set(created.id, createdReply.id);
      }
    }

    // 4j. Keep the real id/number/subject/createdAt around for the Insight/audit artifacts below.
    seededTickets.push({
      id: created.id,
      number: created.number,
      subject: spec.subject,
      spec,
      createdAt,
    });

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
  // Query the real rows back (id + slug + title) — kbGaps below cite REAL seeded KbArticle
  // rows, never string literals; createKbArticle's return value doesn't carry slug.
  const kbArticleRows = await prisma.kbArticle.findMany({ where: { organizationId: orgId } });
  const kbArticleByTitle = new Map(kbArticleRows.map((a) => [a.title, a]));

  // --- 7. No Attachment rows are ever created here — see file header. ---

  // --- Draft lifecycle: 3 KB-adjacent OPEN/PENDING tickets get a DRAFT_GENERATED AuditEvent
  // (grounded in a real seeded KbArticle); 2 of the 3 also get a DRAFT_APPROVED row referencing
  // the ticket's real first PUBLIC agent/admin reply, showing the full generate -> approve
  // sequence in the ticket's AI Activity section. ---
  const draftScenarios: { subject: string; kbTitle: string; draft: string; approved: boolean }[] = [
    {
      subject: "Cannot reset password – reset email never arrives",
      kbTitle: "Resetting your password",
      draft:
        "Hi Sofia, I've sent a fresh password reset link directly — the earlier emails were likely caught by a spam filter on your end. If this one doesn't arrive within a few minutes, we can manually verify the email address on file for your account. [1]",
      approved: true,
    },
    {
      subject: "Invoice shows wrong seat count after downgrade to Pro",
      kbTitle: "Understanding your invoice and billing cycle",
      draft:
        "Hi Priya, thanks for flagging this — when a plan changes mid-cycle, downgrades take effect at the start of the next billing cycle, so your current invoice still reflects the prior Enterprise seat count. Your next invoice will show the updated Pro pricing. [1]",
      approved: false,
    },
    {
      subject: "All webhook retries exhausted – integration completely down",
      kbTitle: "Troubleshooting failed webhook deliveries",
      draft:
        "Hi Derek, I can see every retry was exhausted on our end, which usually means the receiving endpoint returned a non-2xx status or timed out on every attempt. Once your endpoint is healthy again, use the Replay action to resend the missed events — full retry/backoff details are linked below. [1]",
      approved: true,
    },
  ];

  let auditEventCountFromDrafts = 0;
  for (const scenario of draftScenarios) {
    const ticket = seededTickets.find((t) => t.subject === scenario.subject);
    const article = kbArticleByTitle.get(scenario.kbTitle);
    if (!ticket || !article) {
      throw new Error(`[seed] fixtures.ts bug: draft scenario ticket/article not found`);
    }

    await recordAuditEvent(scopedDb(orgId), {
      actionType: "DRAFT_GENERATED",
      ticketId: ticket.id,
      provider: DEMO_ARTIFACT_PROVIDER,
      model: DEMO_ARTIFACT_MODEL,
      input: `[demo seed] redacted grounded-draft prompt for ticket #${ticket.number}`,
      output: JSON.stringify({
        draft: scenario.draft,
        citations: [{ index: 1, title: article.title, articleId: article.id }],
      }),
    });
    auditEventCountFromDrafts += 1;

    if (scenario.approved) {
      const messageId = firstPublicAgentMessageIdByTicketId.get(ticket.id);
      await recordAuditEvent(scopedDb(orgId), {
        actionType: "DRAFT_APPROVED",
        ticketId: ticket.id,
        messageId: messageId ?? null,
        provider: DEMO_ARTIFACT_PROVIDER,
        model: DEMO_ARTIFACT_MODEL,
        input: "draft approved and sent by agent", // fixed non-sensitive marker — never ticket text
        output: JSON.stringify({ approved: true, messageId: messageId ?? null }),
      });
      auditEventCountFromDrafts += 1;
    }
  }

  // --- CSAT — exactly the tickets whose fixture carries a `csat` block (all RESOLVED/CLOSED). ---
  let csatResponseCount = 0;
  for (const t of seededTickets) {
    if (!t.spec.csat) continue;
    const resolvedAtForCsat =
      t.spec.resolvedAfterHours !== null
        ? new Date(t.createdAt.getTime() + t.spec.resolvedAfterHours * HOUR_MS)
        : t.createdAt;
    await prisma.csatResponse.create({
      data: {
        organizationId: orgId,
        ticketId: t.id,
        score: t.spec.csat.score,
        comment: t.spec.csat.comment ?? null,
        createdAt: new Date(resolvedAtForCsat.getTime() + 2 * HOUR_MS),
      },
    });
    csatResponseCount += 1;
  }

  // --- Three COMPLETED InsightRuns (7/30/90 days) so every /insights period tab renders
  // populated. Clusters/gaps/volume drivers/SLA-CSAT are all computed from the REAL seeded
  // ticket data in each window — never invented numbers. ---
  const insightParams: InsightRunParams = {
    clusterSimilarityThreshold: 0.8,
    minClusterSize: 3,
    gapThreshold: 0.5,
    excerptCharLimit: 500,
    embedBatchSize: 100,
    maxClustersRendered: 20,
  };

  let insightRunCount = 0;
  let auditEventCountFromInsights = 0;

  for (const periodDays of [7, 30, 90] as const) {
    const periodEnd = now;
    const periodStart = new Date(now.getTime() - periodDays * DAY_MS);
    const prevWindowStart = new Date(periodStart.getTime() - periodDays * DAY_MS);

    const inWindow = seededTickets.filter(
      (t) => t.createdAt >= periodStart && t.createdAt <= periodEnd,
    );
    const prevWindow = seededTickets.filter(
      (t) => t.createdAt >= prevWindowStart && t.createdAt < periodStart,
    );

    const clusters: StoredCluster[] = INSIGHT_THEMES.map((theme) => ({
      theme,
      members: inWindow.filter((t) => t.spec.tags.includes(theme.tag)),
    }))
      .filter((c) => c.members.length > 0)
      .sort((a, b) => b.members.length - a.members.length)
      .slice(0, 5)
      .map((c, index) => ({
        index,
        label: c.theme.label,
        description: c.theme.description,
        size: c.members.length,
        citations: c.members.map((t) => ({ ticketId: t.id, number: t.number, subject: t.subject })),
      }));

    // kbGaps: the top cluster always cites a REAL seeded KbArticle (illustrative coverage
    // score); the next cluster is the genuine zero-embedded-KB case (coverage/nearestArticle
    // both null) -- truthful, since this seed has no embedded KB chunks at all.
    const kbGaps: StoredKbGap[] = clusters.slice(0, 2).map((cluster, i) => {
      if (i === 0) {
        const theme = INSIGHT_THEMES.find((th) => th.label === cluster.label);
        const article = theme?.kbTitle ? kbArticleByTitle.get(theme.kbTitle) : undefined;
        return {
          clusterIndex: cluster.index,
          label: cluster.label,
          size: cluster.size,
          coverage: article ? 0.42 : null,
          nearestArticle: article
            ? { articleId: article.id, title: article.title, slug: article.slug, score: 0.42 }
            : null,
          citations: cluster.citations.slice(0, 3),
        };
      }
      return {
        clusterIndex: cluster.index,
        label: cluster.label,
        size: cluster.size,
        coverage: null,
        nearestArticle: null,
        citations: cluster.citations.slice(0, 3),
      };
    });

    const volumeDrivers: VolumeDrivers = {
      byCategory: computeVolumeRows(inWindow, prevWindow, (t) => t.spec.triage?.category ?? null),
      byTag: computeTagVolumeRows(inWindow, prevWindow),
      byCompany: computeVolumeRows(
        inWindow,
        prevWindow,
        (t) => DEMO_CONTACTS.find((c) => c.email === t.spec.contactEmail)?.company ?? null,
      ),
    };

    const total = inWindow.length;
    const breachedInWindow = inWindow.filter((t) => t.spec.slaState === "breached").length;
    const atRiskOnlyInWindow = inWindow.filter((t) => t.spec.slaState === "at-risk").length;
    const firstResponseSeconds = inWindow
      .filter((t) => t.spec.firstResponseAfterHours !== null)
      .map((t) => (t.spec.firstResponseAfterHours as number) * 3600);
    const resolutionSeconds = inWindow
      .filter((t) => t.spec.resolvedAfterHours !== null)
      .map((t) => (t.spec.resolvedAfterHours as number) * 3600);
    const csatInWindow = inWindow.filter((t) => t.spec.csat);
    const csatScores = csatInWindow.map((t) => (t.spec.csat as { score: number }).score);

    const slaCsat: SlaCsatSummary = {
      sla: {
        total,
        breached: breachedInWindow,
        atRiskOnly: atRiskOnlyInWindow,
        breachRate: total > 0 ? breachedInWindow / total : 0,
        avgFirstResponseSeconds: average(firstResponseSeconds),
        avgResolutionSeconds: average(resolutionSeconds),
      },
      csat: {
        responseCount: csatInWindow.length,
        averageScore: average(csatScores),
        distribution: [1, 2, 3, 4, 5].map((score) => ({
          score,
          count: csatScores.filter((s) => s === score).length,
        })),
      },
    };

    const topCluster = clusters[0];
    const clusterLine = topCluster
      ? `"${topCluster.label}" was the most common recurring theme, accounting for ${topCluster.size} of the ${total} tickets in this period.`
      : "No recurring theme reached the minimum cluster size in this period.";
    const breachLine =
      slaCsat.sla.breached > 0
        ? `${slaCsat.sla.breached} ticket${slaCsat.sla.breached === 1 ? "" : "s"} breached its SLA target and ${slaCsat.sla.atRiskOnly} ${slaCsat.sla.atRiskOnly === 1 ? "is" : "are"} currently at risk.`
        : "No tickets breached their SLA target in this window.";
    const csatLine =
      slaCsat.csat.responseCount > 0
        ? `Customer satisfaction averaged ${(slaCsat.csat.averageScore as number).toFixed(1)} across ${slaCsat.csat.responseCount} response${slaCsat.csat.responseCount === 1 ? "" : "s"}.`
        : "No CSAT responses were recorded in this window.";
    const narrative: StoredNarrative = {
      summary: `Over the last ${periodDays} days the workspace received ${total} tickets. ${clusterLine} ${breachLine} ${csatLine}`,
    };

    await prisma.insightRun.create({
      data: {
        organizationId: orgId,
        status: "COMPLETED",
        periodDays,
        periodStart,
        periodEnd,
        completedAt: new Date(now.getTime() - 5 * 60_000),
        ticketCount: total,
        embeddingModel: DEMO_ARTIFACT_MODEL,
        provider: DEMO_ARTIFACT_PROVIDER,
        model: DEMO_ARTIFACT_MODEL,
        // Prisma's Json? columns reject a plain typed object/array statically; the app's own
        // orchestrator (run-insight.ts) casts through unknown the same way (Pitfall 5).
        params: insightParams as unknown as Prisma.InputJsonValue,
        clusters: clusters as unknown as Prisma.InputJsonValue,
        kbGaps: kbGaps as unknown as Prisma.InputJsonValue,
        volumeDrivers: volumeDrivers as unknown as Prisma.InputJsonValue,
        slaCsat: slaCsat as unknown as Prisma.InputJsonValue,
        narrative: narrative as unknown as Prisma.InputJsonValue,
      },
    });
    insightRunCount += 1;

    await recordAuditEvent(scopedDb(orgId), {
      actionType: "INSIGHT_CLUSTER_LABELS",
      provider: DEMO_ARTIFACT_PROVIDER,
      model: DEMO_ARTIFACT_MODEL,
      input: `[demo seed] redacted cluster-labeling prompt for the ${periodDays}-day period`,
      output: JSON.stringify({
        clusters: clusters.map((c) => ({ index: c.index, label: c.label })),
      }),
    });
    auditEventCountFromInsights += 1;

    await recordAuditEvent(scopedDb(orgId), {
      actionType: "INSIGHT_SUMMARY",
      provider: DEMO_ARTIFACT_PROVIDER,
      model: DEMO_ARTIFACT_MODEL,
      input: `[demo seed] redacted narrative-summary prompt for the ${periodDays}-day period`,
      output: JSON.stringify(narrative),
    });
    auditEventCountFromInsights += 1;
  }

  // --- 8. Summary. ---
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
    csatResponses: csatResponseCount,
    auditEvents: auditEventCount + auditEventCountFromDrafts + auditEventCountFromInsights,
    insightRuns: insightRunCount,
  };
}
