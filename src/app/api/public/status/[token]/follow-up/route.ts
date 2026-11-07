import { NextResponse } from "next/server";
import {
  FOLLOW_UP_MAX_PARTS,
  MAX_FILES_PER_REQUEST,
  MAX_REQUEST_BODY_BYTES,
} from "@/lib/attachments/constants";
import { queueStagedFilesAfterUncertainCommit } from "@/lib/attachments/uncertain-commit";
import {
  removeStoredUploads,
  storeValidatedUploads,
  validateUploadFiles,
} from "@/lib/attachments/validate-uploads";
import { prisma } from "@/lib/db";
import { readBoundedFormData } from "@/lib/http/read-bounded-form-data";
import { renderMarkdown } from "@/lib/markdown/render";
import { followUpSchema } from "@/lib/public-forms/limits";
import { consumeRateLimit } from "@/lib/rate-limit/check-rate-limit";
import { getRateLimitIdentity } from "@/lib/rate-limit/client-ip";
import { PUBLIC_RATE_LIMITS, rateLimitedResponse } from "@/lib/rate-limit/public-limits";
import {
  ReplyTicketChangedError,
  reopenOnCustomerReply,
  resolveReplyTicket,
} from "@/lib/tickets/reopen-on-reply";

// File-bearing endpoints must run on the Node.js runtime (Buffer/node:fs), never Edge.
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Limit before the token lookup and the body parse, so tokens cannot be probed at full
  // speed and bodies cost nothing once over quota; honeypot hits count toward it (D-22).
  const { scope, max, windowMs } = PUBLIC_RATE_LIMITS.followUp;
  const limit = await consumeRateLimit(scope, getRateLimitIdentity(request), { max, windowMs });
  if (!limit.allowed) {
    return rateLimitedResponse(limit.retryAfterSeconds);
  }

  // Unauthenticated bearer-token flow — the token IS the authorization; bare prisma,
  // never scopedDb (no session/org context exists on this route).
  const ticket = await prisma.ticket.findUnique({
    where: { statusToken: token },
    select: { id: true, organizationId: true, contactId: true },
  });
  if (!ticket) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // The body limit holds on the bytes actually received, however the body is framed; a
  // Content-Length above the cap is only an early reject (D-24). The parts are counted on those
  // bytes before the parse, so many small parts are refused unparsed (K135).
  const body = await readBoundedFormData(request, MAX_REQUEST_BODY_BYTES, {
    maxParts: FOLLOW_UP_MAX_PARTS,
  });
  if (!body.ok) {
    if (body.reason === "too_large")
      return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    if (body.reason === "too_many_parts")
      return NextResponse.json({ error: "too_many_parts" }, { status: 413 });
    return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  }
  const form = body.form;

  // Honeypot (D-20): a real visitor never fills this in. Bots that auto-fill every
  // field get a normal-looking success response — no message is created, and we
  // never tip off the bot with a different status code or error body.
  if (((form.get("company_website") as string | null) ?? "") !== "") {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // A length cap on the message (K129), checked before any file is read or stored.
  const parsed = followUpSchema.safeParse({ message: form.get("message") });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { message } = parsed.data;

  // Every `file` part counts toward the cap, empty ones included (K135); only non-empty files
  // are then read and stored.
  const fileParts = form.getAll("file");
  if (fileParts.length > MAX_FILES_PER_REQUEST) {
    return NextResponse.json({ error: "too_many_files" }, { status: 413 });
  }
  const files = fileParts.filter((f): f is File => f instanceof File && f.size > 0);

  // Every file is validated (size, the combined cap shared with intake, sniffed type) before
  // any is stored, so a 413/415 leaves no file behind (D-24, F-12).
  const validated = await validateUploadFiles(files);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: validated.status });
  }

  // Review C7: files are stored before the transaction and removed whenever no message
  // commits (a refusal or a thrown error); the removal is best-effort (12-03, review R3-2).
  const stored = await storeValidatedUploads(ticket.organizationId, validated.uploads);
  const discard = () =>
    removeStoredUploads(
      ticket.organizationId,
      stored.map((s) => s.storageKey),
    );

  // The effective ticket (the token's ticket, or its merge target) is decided inside the
  // transaction under the row lock (D-09, D-10), and nothing is written before that. The
  // auto-reopen (D-04) applies to the effective ticket; triggeredReopen is set true ONLY on the
  // reopening message, in the same transaction as the status write (Phase 11, D-17).
  let outcome: "ok" | "unavailable";
  // K148: set when the callback has written every row and returns, so COMMIT is sent next. An
  // error after that point has an unknown outcome: the files are queued, never unlinked.
  let commitSent = false;
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const resolved = await resolveReplyTicket(tx, ticket.organizationId, ticket.id);
      if (!resolved.ok) return "unavailable";
      const effectiveTicketId = resolved.ticketId;

      const reopened = await reopenOnCustomerReply(tx, {
        orgId: ticket.organizationId,
        ticketId: effectiveTicketId,
        isAutoGenerated: false,
      });

      const created = await tx.message.create({
        data: {
          organizationId: ticket.organizationId,
          ticketId: effectiveTicketId,
          direction: "INBOUND",
          visibility: "PUBLIC",
          authorContactId: ticket.contactId,
          bodyMarkdown: message,
          bodyHtml: renderMarkdown(message),
          triggeredReopen: reopened,
        },
      });

      for (const entry of stored) {
        await tx.attachment.create({
          data: {
            organizationId: ticket.organizationId,
            messageId: created.id,
            storageKey: entry.storageKey,
            originalFilename: entry.originalFilename,
            mimeType: entry.mimeType,
            sizeBytes: entry.sizeBytes,
          },
        });
      }
      commitSent = true;
      return "ok";
    });
  } catch (err) {
    if (commitSent) {
      await queueStagedFilesAfterUncertainCommit(
        ticket.organizationId,
        stored.map((s) => s.storageKey),
      );
      throw err;
    }
    await discard();
    if (err instanceof ReplyTicketChangedError) {
      return NextResponse.json({ error: "TICKET_CHANGED" }, { status: 409 });
    }
    throw err;
  }

  if (outcome !== "ok") {
    await discard();
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
