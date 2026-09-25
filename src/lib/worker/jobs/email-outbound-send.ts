// Worker job: sends a QUEUED outbound public-reply Message via SMTP and flips deliveryStatus
// to SENT/FAILED. Enqueued by the app (src/lib/queue/boss-client.ts, messages Route Handler),
// registered by plan 04's worker/index.ts (this plan only exports the handler — see 03-05-PLAN.md
// objective note: the two plans must never both edit the worker entrypoint).
//
// Worker-bundleable (esbuild) — every import below is relative to src/lib/worker/jobs/, i.e.
// TWO levels up to src/lib/ then down, exactly like heartbeat.ts's `import { prisma } from "../../db"`.
//
// Thread of a merged ticket (Phase 12, run decision K37, replaces K36; Codex diff round 2,
// R2-2): a reply keeps the email thread of the ticket it was written on, its ORIGIN.
//   - origin = message.mergedFromTicketId ?? message.ticketId. A merge (D-08) moves a QUEUED
//     reply to the target and sets mergedFromTicketId to the source, so a reply written on the
//     source still names the source after the merge; a reply written on the target after the
//     merge has no mergedFromTicketId and names the target.
//   - Subject and number come from the origin ticket, so "Re: {subject} [#{number}]" is the
//     thread the customer already has.
//   - Recipient: the origin ticket's contact. A merge refuses tickets of different contacts
//     (D-07, K33), so it is the same contact as the ticket the message is on now.
//   - History for References / In-Reply-To: every email-bearing message with ticketId = origin
//     OR mergedFromTicketId = origin, except this one, oldest first. Before a merge the origin's
//     messages match the first term and after it the second, so a send that read the message
//     before a merge and the history after it gets the same thread as one that read both on
//     either side of the merge. A target's thread also holds the messages moved into it, as
//     before K37.
// Every read after the message lookup goes through scopedDb(message.organizationId).

import { getBrandingSettings } from "../../branding/settings";
import { buildOutboundMessageId, composeMail } from "../../channels/email/compose-outbound";
import { getEmailSettings } from "../../channels/email/settings";
import { createSmtpTransport } from "../../channels/email/smtp-client";
import { prisma } from "../../db";
import { scopedDb } from "../../scoped-db";

/** Test seam of the send job. Production code never sets it. */
export interface OutboundSendObserver {
  /** Awaited right after the message is read, before the origin ticket and the history. */
  afterMessageRead?(): Promise<void> | void;
}

let outboundSendObserver: OutboundSendObserver | null = null;

/**
 * Test seam only (as setAgentMessageObserverForTests): lets a test commit a merge between the
 * message read and the history read (R2-2). null clears it.
 */
export function setOutboundSendObserverForTests(observer: OutboundSendObserver | null): void {
  outboundSendObserver = observer;
}

export async function emailOutboundSendHandler(data: { messageId: string }): Promise<void> {
  const message = await prisma.message.findUnique({
    where: { id: data.messageId },
    include: { ticket: { include: { organization: true } } },
  });

  if (!message) return;
  if (outboundSendObserver?.afterMessageRead) await outboundSendObserver.afterMessageRead();
  if (message.direction !== "OUTBOUND" || message.visibility !== "PUBLIC") return;

  const db = scopedDb(message.organizationId);
  // K37: the ticket the reply was written on (see the header).
  const originTicketId = message.mergedFromTicketId ?? message.ticketId;
  const origin = await db.ticket.findFirst({
    where: { id: originTicketId },
    select: { subject: true, number: true, contact: { select: { email: true } } },
  });
  if (!origin?.contact.email) return;

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

  // Threading headers (D-23): every prior email-bearing message of the origin's thread (K37),
  // EXCLUDING this one (a retry may already carry its own emailMessageId from a prior failed
  // attempt, which would otherwise self-reference in the chain).
  const priorMessages = await db.message.findMany({
    where: {
      OR: [{ ticketId: originTicketId }, { mergedFromTicketId: originTicketId }],
      id: { not: message.id },
      emailMessageId: { not: null },
    },
    orderBy: { createdAt: "asc" },
    select: { emailMessageId: true, direction: true },
  });
  const references = priorMessages.map((m) => m.emailMessageId).filter((id): id is string => !!id);
  const lastInbound = [...priorMessages].reverse().find((m) => m.direction === "INBOUND");
  const inReplyTo = lastInbound?.emailMessageId ?? undefined;

  const branding = await getBrandingSettings(db, message.ticket.organization.name);

  const transporter = createSmtpTransport(settings);
  const mail = composeMail({
    fromAddress: settings.fromAddress,
    fromName: branding.workspaceName,
    to: origin.contact.email,
    subject: `Re: ${origin.subject} [#${origin.number}]`,
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
