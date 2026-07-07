// runTriage(ticketId) — classifies a ticket's initial message via the model-agnostic lib/llm
// port, writes the ticket's own triage fields (advisory/overrideable per D-09) with a
// manual-override race guard (Pitfall 5), and records a redacted AuditEvent (D-17).
//
// Relative imports only (no `@/`) — bundled into the worker by the ai-triage job (04-05).
import { recordAuditEvent } from "../audit/record-audit-event";
import { prisma } from "../db";
import { complete } from "../llm/complete";
import { scopedDb } from "../scoped-db";
import { computeDueTimestamps, getSlaTargets } from "../tickets/sla";
import { buildTriageUserPrompt, TRIAGE_SYSTEM_PROMPT } from "./prompt";
import { TriageResultSchema } from "./schema";

export async function runTriage(ticketId: string): Promise<void> {
  // Bare prisma first (worker cross-org context) — we don't know the org until we've loaded
  // the ticket.
  const bare = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!bare) return;

  const db = scopedDb(bare.organizationId);

  const loaded = await db.ticket.findFirst({
    where: { id: ticketId },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 1 } },
  });
  if (!loaded) return;

  // IDEMPOTENCY: pg-boss may deliver a completed job again — never re-triage. Do NOT
  // early-return on FAILED — a retry after a failed attempt must proceed.
  if (loaded.triageStatus === "COMPLETED") return;

  const firstMessage = loaded.messages[0];
  if (!firstMessage) return;

  try {
    const userPrompt = buildTriageUserPrompt(loaded.subject, firstMessage.bodyMarkdown);

    const { output, redactedPrompt, provider, model } = await complete(db, {
      system: TRIAGE_SYSTEM_PROMPT,
      prompt: userPrompt,
      schema: TriageResultSchema,
      schemaName: "TriageResult",
    });

    // WRITE with the race guard (Pitfall 5). category/sentiment/language never conflict
    // (nothing else sets them); priority MAY conflict with a fast manual changePriority.
    const targets = await getSlaTargets(db, output.priority);
    const { firstResponseDueAt, resolutionDueAt } = computeDueTimestamps(
      loaded.createdAt,
      targets.firstResponseMinutes,
      targets.resolutionMinutes,
    );

    const guarded = await db.ticket.updateMany({
      where: { id: ticketId, updatedAt: loaded.updatedAt }, // optimistic token
      data: {
        triageCategory: output.category,
        triageSentiment: output.sentiment,
        triageLanguage: output.language,
        triageStatus: "COMPLETED",
        priority: output.priority,
        firstResponseTargetMinutes: targets.firstResponseMinutes,
        resolutionTargetMinutes: targets.resolutionMinutes,
        firstResponseDueAt,
        resolutionDueAt,
        isAtRisk: false,
        isBreached: false,
      },
    });

    if (guarded.count === 0) {
      // Agent edited during the LLM call — respect their priority; still attach the
      // non-conflicting classification.
      await db.ticket.update({
        where: { id: ticketId },
        data: {
          triageCategory: output.category,
          triageSentiment: output.sentiment,
          triageLanguage: output.language,
          triageStatus: "COMPLETED",
        },
      });
    }

    await recordAuditEvent(db, {
      actionType: "TRIAGE",
      ticketId,
      provider,
      model,
      input: redactedPrompt, // D-13 — the REDACTED prompt, never raw ticket text
      output: JSON.stringify(output),
    });
  } catch (err) {
    await db.ticket.update({ where: { id: ticketId }, data: { triageStatus: "FAILED" } });
    throw err; // pg-boss retries — mirrors email-outbound-send
  }
}
