import { fileTypeFromBuffer } from "file-type";
import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { ALLOWED_MIME, MAX_BYTES, MAX_TOTAL_REQUEST_BYTES } from "@/lib/attachments/constants";
import { buildStorageKey, localFileStorage } from "@/lib/attachments/local-file-storage";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit/check-rate-limit";
import { createTicket } from "@/lib/tickets/create-ticket";

// File-bearing endpoints must run on the Node.js runtime (Buffer/node:fs), never Edge.
export const runtime = "nodejs";

const intakeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email address is required"),
  subject: z.string().min(1, "Subject is required"),
  message: z.string().min(1, "Message is required"),
});

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_TOTAL_REQUEST_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  }

  // Honeypot (D-20): a real visitor never fills this in. Bots that auto-fill every
  // field get a normal-looking success response — no ticket is created, and we
  // never tip off the bot with a different status code or error body.
  if (((form.get("company_website") as string | null) ?? "") !== "") {
    return NextResponse.json({ ok: true, token: null }, { status: 200 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await checkRateLimit("public-intake", ip))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

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

  // Single-org v1: bare prisma lookup (RESEARCH.md Open Q2). Becomes an org-slug-scoped
  // lookup if/when multi-org public intake is ever needed — out of scope for v1.
  const org = await prisma.organization.findFirstOrThrow();

  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);

  const stored: {
    storageKey: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
  }[] = [];
  let totalBytes = 0;
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "file_too_large" }, { status: 413 });
    }
    totalBytes += file.size;
    if (totalBytes > MAX_TOTAL_REQUEST_BYTES) {
      return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sniffed = await fileTypeFromBuffer(buffer);
    if (!sniffed || !ALLOWED_MIME.has(sniffed.mime)) {
      return NextResponse.json({ error: "unsupported_file_type" }, { status: 415 });
    }

    const key = buildStorageKey(file.name);
    await localFileStorage.save({ orgId: org.id, key, data: buffer });
    stored.push({
      storageKey: key,
      originalFilename: file.name,
      mimeType: sniffed.mime,
      sizeBytes: file.size,
    });
  }

  const ticket = await createTicket(org.id, {
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
      await prisma.attachment.createMany({
        data: stored.map((s) => ({
          organizationId: org.id,
          messageId: initialMessage.id,
          storageKey: s.storageKey,
          originalFilename: s.originalFilename,
          mimeType: s.mimeType,
          sizeBytes: s.sizeBytes,
        })),
      });
    }
  }

  return NextResponse.json({ ok: true, token: ticket.statusToken }, { status: 200 });
}
