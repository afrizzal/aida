import { fileTypeFromBuffer } from "file-type";
import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { ALLOWED_MIME, MAX_BYTES } from "@/lib/attachments/constants";
import { buildStorageKey, localFileStorage } from "@/lib/attachments/local-file-storage";
import { prisma } from "@/lib/db";
import { renderMarkdown } from "@/lib/markdown/render";
import { checkRateLimit } from "@/lib/rate-limit/check-rate-limit";

// File-bearing endpoints must run on the Node.js runtime (Buffer/node:fs), never Edge.
export const runtime = "nodejs";

const followUpSchema = z.object({
  message: z.string().min(1, "Message is required"),
});

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Unauthenticated bearer-token flow — the token IS the authorization; bare prisma,
  // never scopedDb (no session/org context exists on this route).
  const ticket = await prisma.ticket.findUnique({ where: { statusToken: token } });
  if (!ticket) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  }

  // Honeypot (D-20): a real visitor never fills this in. Bots that auto-fill every
  // field get a normal-looking success response — no message is created, and we
  // never tip off the bot with a different status code or error body.
  if (((form.get("company_website") as string | null) ?? "") !== "") {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await checkRateLimit("status-follow-up", ip))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = followUpSchema.safeParse({ message: form.get("message") });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { message } = parsed.data;

  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);

  const stored: {
    storageKey: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
  }[] = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "file_too_large" }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sniffed = await fileTypeFromBuffer(buffer);
    if (!sniffed || !ALLOWED_MIME.has(sniffed.mime)) {
      return NextResponse.json({ error: "unsupported_file_type" }, { status: 415 });
    }

    const key = buildStorageKey(file.name);
    await localFileStorage.save({ orgId: ticket.organizationId, key, data: buffer });
    stored.push({
      storageKey: key,
      originalFilename: file.name,
      mimeType: sniffed.mime,
      sizeBytes: file.size,
    });
  }

  // Auto-reopen (D-04): a requester follow-up on a RESOLVED/CLOSED ticket reopens it.
  // triggeredReopen is set true ONLY on this reopening message, in the same
  // transaction as the ticket status write — mirrors the SLA-flag same-write pattern
  // from 02-09 (never a separate, later write).
  const shouldReopen = ticket.status === "RESOLVED" || ticket.status === "CLOSED";

  await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        organizationId: ticket.organizationId,
        ticketId: ticket.id,
        direction: "INBOUND",
        visibility: "PUBLIC",
        authorContactId: ticket.contactId,
        bodyMarkdown: message,
        bodyHtml: renderMarkdown(message),
        triggeredReopen: shouldReopen,
      },
    });

    for (const file of stored) {
      await tx.attachment.create({
        data: {
          organizationId: ticket.organizationId,
          messageId: created.id,
          storageKey: file.storageKey,
          originalFilename: file.originalFilename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
        },
      });
    }

    if (shouldReopen) {
      await tx.ticket.update({
        where: { id: ticket.id },
        data: { status: "OPEN", resolvedAt: null },
      });
    }
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
