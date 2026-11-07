import { NextResponse } from "next/server";
import {
  INTAKE_MAX_PARTS,
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
import { intakeSchema } from "@/lib/public-forms/limits";
import { consumeRateLimit } from "@/lib/rate-limit/check-rate-limit";
import { getRateLimitIdentity } from "@/lib/rate-limit/client-ip";
import { PUBLIC_RATE_LIMITS, rateLimitedResponse } from "@/lib/rate-limit/public-limits";
import { createTicket } from "@/lib/tickets/create-ticket";

// File-bearing endpoints must run on the Node.js runtime (Buffer/node:fs), never Edge.
export const runtime = "nodejs";

export async function POST(request: Request) {
  // Limit first, before the size check and the body parse, so an over-quota client costs no
  // parsing; honeypot hits count toward the quota (D-22).
  const { scope, max, windowMs } = PUBLIC_RATE_LIMITS.intake;
  const limit = await consumeRateLimit(scope, getRateLimitIdentity(request), { max, windowMs });
  if (!limit.allowed) {
    return rateLimitedResponse(limit.retryAfterSeconds);
  }

  // The body limit holds on the bytes actually received, however the body is framed; a
  // Content-Length above the cap is only an early reject (D-24). The parts are counted on those
  // bytes before the parse, so many small parts are refused unparsed (K135).
  const body = await readBoundedFormData(request, MAX_REQUEST_BODY_BYTES, {
    maxParts: INTAKE_MAX_PARTS,
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
  // field get a normal-looking success response — no ticket is created, and we
  // never tip off the bot with a different status code or error body.
  if (((form.get("company_website") as string | null) ?? "") !== "") {
    return NextResponse.json({ ok: true, token: null }, { status: 200 });
  }

  // Length caps on every field (K129); a failure is a 400 with one issue per field.
  const parsed = intakeSchema.safeParse({
    name: form.get("name"),
    email: form.get("email"),
    subject: form.get("subject"),
    message: form.get("message"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { name, email, subject, message } = parsed.data;

  // Every file is validated (size, running total, content sniff) before any is stored (D-24).
  // Every `file` part counts toward the cap, empty ones included (K135); only non-empty files
  // are then read and stored.
  const fileParts = form.getAll("file");
  if (fileParts.length > MAX_FILES_PER_REQUEST) {
    return NextResponse.json({ error: "too_many_files" }, { status: 413 });
  }
  const files = fileParts.filter((f): f is File => f instanceof File && f.size > 0);
  const validated = await validateUploadFiles(files);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: validated.status });
  }

  // Single-org v1: bare prisma lookup (RESEARCH.md Open Q2). Becomes an org-slug-scoped
  // lookup if/when multi-org public intake is ever needed — out of scope for v1.
  const org = await prisma.organization.findFirstOrThrow();

  const stored = await storeValidatedUploads(org.id, validated.uploads);

  // A failure after the files are stored (ticket creation, attachment rows) removes them, then
  // the error propagates unchanged (D-24).
  let ticket: Awaited<ReturnType<typeof createTicket>>;
  // K148: the attachment insert runs in its own transaction, and this is set when that callback
  // has inserted the rows and returns, so COMMIT is sent next. An error from then on has an
  // unknown outcome (the rows may have committed with the reply lost): the files are queued for
  // the reference-checked sweep, never unlinked. An error inside the callback (a failed insert)
  // leaves it false and keeps the immediate removal.
  let commitSent = false;
  try {
    ticket = await createTicket(org.id, {
      subject,
      priority: "NORMAL", // customers never set priority (D-05)
      body: message,
      contact: { email, name },
      direction: "INBOUND",
    });

    if (stored.length > 0) {
      // createTicket already created the initial inbound Message inside its own
      // transaction — find it here to link the stored attachments to it.
      const initialMessage = await prisma.message.findFirst({
        where: { ticketId: ticket.id },
        orderBy: { createdAt: "asc" },
      });
      if (initialMessage) {
        await prisma.$transaction(async (tx) => {
          await tx.attachment.createMany({
            data: stored.map((s) => ({
              organizationId: org.id,
              messageId: initialMessage.id,
              storageKey: s.storageKey,
              originalFilename: s.originalFilename,
              mimeType: s.mimeType,
              sizeBytes: s.sizeBytes,
            })),
          });
          commitSent = true;
        });
      }
    }
  } catch (err) {
    const keys = stored.map((s) => s.storageKey);
    if (commitSent) await queueStagedFilesAfterUncertainCommit(org.id, keys);
    else await removeStoredUploads(org.id, keys);
    throw err;
  }

  return NextResponse.json({ ok: true, token: ticket.statusToken }, { status: 200 });
}
