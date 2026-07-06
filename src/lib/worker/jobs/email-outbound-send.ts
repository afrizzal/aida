// Worker job: sends a QUEUED outbound public-reply Message via SMTP and flips deliveryStatus
// to SENT/FAILED. Enqueued by the app (src/lib/queue/boss-client.ts, messages Route Handler),
// registered by plan 04's worker/index.ts (this plan only exports the handler — see 03-05-PLAN.md
// objective note: the two plans must never both edit the worker entrypoint).
//
// Worker-bundleable (esbuild) — every import below is relative to src/lib/worker/jobs/, i.e.
// TWO levels up to src/lib/ then down, exactly like heartbeat.ts's `import { prisma } from "../../db"`.
import { prisma } from "../../db";
import { buildOutboundMessageId, composeMail } from "../../channels/email/compose-outbound";
import { getEmailSettings } from "../../channels/email/settings";
import { createSmtpTransport } from "../../channels/email/smtp-client";
import { scopedDb } from "../../scoped-db";

export async function emailOutboundSendHandler(data: { messageId: string }): Promise<void> {
  const message = await prisma.message.findUnique({
    where: { id: data.messageId },
    include: { ticket: { include: { contact: true, organization: true } } },
  });

  if (!message) return;
  if (message.direction !== "OUTBOUND" || message.visibility !== "PUBLIC") return;
  if (!message.ticket.contact.email) return;

  const db = scopedDb(message.organizationId);
  const settings = await getEmailSettings(db);
  if (!settings.enabled) return;

  // Reuse the existing Message-ID on retry (stable threading across attempts); generate once
  // and persist otherwise. Bracket-consistent with mailparser's inbound In-Reply-To/References
  // format (RESEARCH.md Pitfall 1).
  const domain = settings.fromAddress.split("@")[1] || "localhost";
  const messageId = message.emailMessageId ?? buildOutboundMessageId(domain);
  if (!message.emailMessageId) {
    await db.message.update({ where: { id: message.id }, data: { emailMessageId: messageId } });
  }

  // Threading headers (D-23): every prior email-bearing message on this ticket, EXCLUDING this
  // one (a retry may already carry its own emailMessageId from a prior failed attempt, which
  // would otherwise self-reference in the chain).
  const priorMessages = await db.message.findMany({
    where: { ticketId: message.ticketId, id: { not: message.id }, emailMessageId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { emailMessageId: true, direction: true },
  });
  const references = priorMessages
    .map((m) => m.emailMessageId)
    .filter((id): id is string => !!id);
  const lastInbound = [...priorMessages].reverse().find((m) => m.direction === "INBOUND");
  const inReplyTo = lastInbound?.emailMessageId ?? undefined;

  const transporter = createSmtpTransport(settings);
  const mail = composeMail({
    fromAddress: settings.fromAddress,
    fromName: message.ticket.organization.name,
    to: message.ticket.contact.email,
    subject: `Re: ${message.ticket.subject} [#${message.ticket.number}]`,
    bodyMarkdown: message.bodyMarkdown,
    messageId,
    inReplyTo,
    references,
  });

  try {
    await transporter.sendMail(mail);
  } catch (err) {
    // Never log settings.smtpPassword or full email bodies (SECURITY.md).
    console.error("[worker] email-outbound-send failed:", err instanceof Error ? err.message : err);
    await db.message.update({ where: { id: message.id }, data: { deliveryStatus: "FAILED" } });
    throw err; // rethrow so pg-boss retries per the queue's retryLimit
  }

  await db.message.update({ where: { id: message.id }, data: { deliveryStatus: "SENT" } });
}
