import { fileTypeFromBuffer } from "file-type";
import { NextResponse } from "next/server";
import { ALLOWED_MIME, MAX_BYTES } from "@/lib/attachments/constants";
import { buildStorageKey, localFileStorage } from "@/lib/attachments/local-file-storage";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { getEmailSettings } from "@/lib/channels/email/settings";
import { resolveActiveProvider } from "@/lib/llm/active-provider";
import { renderMarkdown } from "@/lib/markdown/render";
import { getBoss } from "@/lib/queue/boss-client";
import { getScopedDb } from "@/lib/session";

// File-bearing endpoints must run on the Node.js runtime (Buffer/node:fs), never Edge.
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // getScopedDb() redirects (next/navigation redirect()) when unauthenticated — that
  // throw is caught here and converted into a clean 401 for this fetch-based endpoint,
  // rather than letting a raw redirect response reach the composer's fetch() call.
  let scoped: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    scoped = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { db, orgId, session } = scoped;

  const { id: ticketId } = await params;

  const ticket = await db.ticket.findFirst({ where: { id: ticketId } });
  if (!ticket) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  }

  const mode = form.get("mode") === "internal" ? "internal" : "public";
  const body = (form.get("body") as string | null) ?? "";
  const fromDraft = form.get("fromDraft") === "true";
  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);

  if (!body.trim() && files.length === 0) {
    return NextResponse.json({ error: "empty_message" }, { status: 400 });
  }

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
    await localFileStorage.save({ orgId, key, data: buffer });
    stored.push({
      storageKey: key,
      originalFilename: file.name,
      mimeType: sniffed.mime,
      sizeBytes: file.size,
    });
  }

  // D-26: channel-off (or unconfigured) replies behave exactly as in Phase 2 — no enqueue,
  // no deliveryStatus. Computed BEFORE the transaction; the send handler re-checks the actual
  // contact email, this gate only needs to know a contact is linked at all.
  const emailSettings = await getEmailSettings(db);
  const shouldQueue = mode === "public" && emailSettings.enabled && !!ticket.contactId;

  const messageId = await db.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        organizationId: orgId,
        ticketId,
        direction: "OUTBOUND",
        visibility: mode === "internal" ? "INTERNAL" : "PUBLIC",
        authorUserId: session.user.id,
        bodyMarkdown: body,
        bodyHtml: renderMarkdown(body),
        deliveryStatus: shouldQueue ? "QUEUED" : undefined,
      },
    });

    for (const file of stored) {
      await tx.attachment.create({
        data: {
          organizationId: orgId,
          messageId: message.id,
          storageKey: file.storageKey,
          originalFilename: file.originalFilename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
        },
      });
    }

    // Pitfall 5: clear at-risk/breach in the SAME write as stamping firstRespondedAt —
    // the sla-flag worker job is one-directional (only ever sets these flags).
    if (mode === "public" && !ticket.firstRespondedAt) {
      await tx.ticket.update({
        where: { id: ticketId },
        data: { firstRespondedAt: new Date(), isAtRisk: false, isBreached: false },
      });
    }

    return message.id;
  });

  // Enqueue AFTER commit so the worker never races an uncommitted row.
  if (shouldQueue) {
    const boss = await getBoss();
    await boss.send("email-outbound-send", { messageId });
  }

  // AIDA-16 human-approval-gate closure: only a draft-originated PUBLIC send records the
  // approval audit (internal notes and manually-typed replies never set fromDraft, so their
  // behavior is byte-identical to before this plan). Best-effort and non-blocking -- an audit
  // failure must never prevent the send response from reaching the agent.
  if (fromDraft && mode === "public") {
    try {
      let provider = "";
      let model = "";
      try {
        const active = await resolveActiveProvider(db);
        provider = active.provider;
        model = active.model;
      } catch {
        // Provider config gone/never configured -- still record the approval, just without
        // a resolved provider/model.
      }
      await recordAuditEvent(db, {
        actionType: "DRAFT_APPROVED",
        ticketId,
        messageId,
        provider,
        model,
        input: "draft approved and sent by agent", // fixed non-sensitive marker -- never customer/ticket text
        output: JSON.stringify({ approved: true, messageId }),
      });
    } catch {
      // Never block the send response on an audit-write failure.
    }
  }

  return NextResponse.json({ ok: true });
}
