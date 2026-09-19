import { fileTypeFromBuffer } from "file-type";
import { NextResponse } from "next/server";
import { ALLOWED_MIME, MAX_BYTES } from "@/lib/attachments/constants";
import { buildStorageKey, localFileStorage } from "@/lib/attachments/local-file-storage";
import { saveStagedFiles } from "@/lib/attachments/staged-files";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { getEmailSettings } from "@/lib/channels/email/settings";
import { resolveActiveProvider } from "@/lib/llm/active-provider";
import { renderMarkdown } from "@/lib/markdown/render";
import { getBoss } from "@/lib/queue/boss-client";
import { getScopedDb } from "@/lib/session";
import { getAgentMessageObserver, lockTicketForAgentWrite } from "@/lib/tickets/merge";

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
    data: Buffer;
  }[] = [];

  // Every file is validated before any is stored, so a 413/415 leaves no file behind.
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "file_too_large" }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sniffed = await fileTypeFromBuffer(buffer);
    if (!sniffed || !ALLOWED_MIME.has(sniffed.mime)) {
      return NextResponse.json({ error: "unsupported_file_type" }, { status: 415 });
    }

    stored.push({
      storageKey: buildStorageKey(file.name),
      originalFilename: file.name,
      mimeType: sniffed.mime,
      sizeBytes: file.size,
      data: buffer,
    });
  }

  // D-26: channel-off (or unconfigured) replies behave exactly as in Phase 2 — no enqueue,
  // no deliveryStatus. Computed BEFORE the transaction; the send handler re-checks the actual
  // contact email, this gate only needs to know a contact is linked at all.
  const emailSettings = await getEmailSettings(db);
  const shouldQueue = mode === "public" && emailSettings.enabled && !!ticket.contactId;

  // Review C7: files are staged before the transaction and discarded whenever the request ends
  // without a committed message (refusal or thrown error). Cleanup is best-effort (R3-2).
  const staged = await saveStagedFiles(
    localFileStorage,
    orgId,
    stored.map((file) => ({ key: file.storageKey, data: file.data })),
  );

  let outcome: { ok: true; messageId: string } | { ok: false; error: string };
  try {
    outcome = await db.$transaction(async (tx) => {
      const observer = getAgentMessageObserver();
      if (observer?.onTransactionStart) await observer.onTransactionStart(tx);
      // AIDA-53: every agent message insert happens under the ticket row lock and a merged
      // source is refused before anything is written (review C1, UI-SPEC Assumption 7).
      const lock = await lockTicketForAgentWrite(tx, orgId, ticketId);
      if (observer?.afterLock) await observer.afterLock(tx);
      if (!lock.ok) return { ok: false as const, error: lock.error };

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

      return { ok: true as const, messageId: message.id };
    });
  } catch (err) {
    await staged.discard();
    throw err;
  }

  if (!outcome.ok) {
    await staged.discard();
    if (outcome.error === "MERGED_SOURCE") {
      return NextResponse.json({ error: "MERGED_SOURCE" }, { status: 409 });
    }
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const messageId = outcome.messageId;

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
