import { fileTypeFromBuffer } from "file-type";
import { NextResponse } from "next/server";
import { ALLOWED_MIME, MAX_BYTES } from "@/lib/attachments/constants";
import { buildStorageKey, localFileStorage } from "@/lib/attachments/local-file-storage";
import { saveStagedFiles } from "@/lib/attachments/staged-files";
import {
  boundUploadCommitInTx,
  queueStagedFilesAfterUncertainCommit,
} from "@/lib/attachments/uncertain-commit";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { getEmailSettings } from "@/lib/channels/email/settings";
import { classifyGateFailure, gateFailureStatus } from "@/lib/http/gate-failure";
import { resolveActiveProvider } from "@/lib/llm/active-provider";
import { renderMarkdownWithMentions } from "@/lib/markdown/render";
import { AccessDeniedError, findActiveMembership } from "@/lib/membership";
import {
  MentionError,
  type MentionedMember,
  parseMentionField,
  recordMentions,
  resolveMentionedMembers,
} from "@/lib/mentions/mentions";
import { getBoss } from "@/lib/queue/boss-client";
import { getScopedDb } from "@/lib/session";
import { getAgentMessageObserver, lockTicketForAgentWrite } from "@/lib/tickets/merge";

// File-bearing endpoints must run on the Node.js runtime (Buffer/node:fs), never Edge.
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // getScopedDb() redirects (next/navigation redirect()) when unauthenticated — that
  // throw is caught here and converted into a clean 401 for this fetch-based endpoint,
  // rather than letting a raw redirect response reach the composer's fetch() call.
  // Phase 10 (D-08, AIDA-43): getScopedDb throws AccessDeniedError when the session has no active
  // organization or the user holds no member row in it; that is a 403, never a 401.
  let scoped: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    scoped = await getScopedDb();
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return NextResponse.json({ error: "membership_ended" }, { status: err.status });
    }
    // a-IN-7: only the redirect to /login is a 401; a database failure in the gate is a 500.
    const failure = classifyGateFailure("api/tickets/messages", err);
    return NextResponse.json({ error: failure }, { status: gateFailureStatus(failure) });
  }
  const { db, orgId, session } = scoped;

  // D-01 (Codex diff round 1, D2): a user removed from the organization whose session still names
  // it is refused before the ticket, the body, the email settings or any file is read or staged:
  // getScopedDb above already re-reads the member rows (Phase 10), and this check stays as the
  // pre-transaction guard. A removed member gets the same 403 for an existing id, a missing id
  // and an invalid body, so this route is no oracle for the former organization's ticket ids. The
  // check inside the transaction below stays: it covers a removal that commits after this read.
  if (!(await findActiveMembership(db, session.user.id, orgId))) {
    return NextResponse.json({ error: "MEMBERSHIP_ENDED" }, { status: 403 });
  }

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

  // Phase 10, AIDA-45 (D-20, D-21, V-12): the mentioned user ids travel in the `mentions` field.
  // Malformed data, more than MAX_MENTIONS ids, or any mention on a public reply is a 400 here,
  // before any file is staged and before the transaction, so nothing is written. Plain `@text`
  // in a public reply is only text: it has no ids, so it is never a mention.
  let mentionIds: string[];
  try {
    mentionIds = parseMentionField(form.get("mentions"), mode);
  } catch (err) {
    if (err instanceof MentionError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
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
  // K148: set when the callback has written every row and returns, so COMMIT is sent next. An
  // error after that point has an unknown outcome: the files are queued, never unlinked.
  let commitSent = false;
  let uploadXactId: string | null = null;
  try {
    outcome = await db.$transaction(async (tx) => {
      const observer = getAgentMessageObserver();
      if (observer?.onTransactionStart) await observer.onTransactionStart(tx);
      // D-01 (review WR-03): checked again inside the transaction, so a removal that commits
      // after the first check above is still refused here, before the ticket lock and before
      // anything is written or queued.
      if (!(await findActiveMembership(tx, session.user.id, orgId))) {
        return { ok: false as const, error: "MEMBERSHIP_ENDED" };
      }
      // AIDA-53: every agent message insert happens under the ticket row lock and a merged
      // source is refused before anything is written (review C1, UI-SPEC Assumption 7).
      const lock = await lockTicketForAgentWrite(tx, orgId, ticketId);
      if (observer?.afterLock) await observer.afterLock(tx);
      if (!lock.ok) return { ok: false as const, error: lock.error };

      // AIDA-45 (V-12, V-26): mentioned ids are validated against the organization's member rows
      // here, after the membership re-check and the ticket lock and inside this transaction.
      // Deviation from V-12's word order (recorded in the plan's ledger): this runs just before
      // message.create rather than after it, because bodyHtml is computed at create time and
      // needs the validated names; the writes below still follow the create in this transaction.
      // Internal notes only (D-21; parseMentionField already refused ids on a public reply).
      const resolved: MentionedMember[] =
        mode === "internal" && mentionIds.length > 0
          ? await resolveMentionedMembers(tx, orgId, session.user.id, mentionIds)
          : [];
      // Run decision K172 (review d-WR-2): a member is recorded and notified only when the body
      // shows their current display name as a mention, on the boundary rule of
      // src/lib/mentions/mention-syntax.ts; the renderer reports the names it wrapped. Any other
      // id (a body without the name, "@Namex", a member renamed since the composer loaded the
      // list) is dropped and notifies nobody.
      const rendered = renderMarkdownWithMentions(body, {
        mentionNames: resolved.map((m) => m.displayName),
      });
      const mentioned = resolved.filter((m) => rendered.mentionedNames.includes(m.displayName));

      const message = await tx.message.create({
        data: {
          organizationId: orgId,
          ticketId,
          direction: "OUTBOUND",
          visibility: mode === "internal" ? "INTERNAL" : "PUBLIC",
          authorUserId: session.user.id,
          bodyMarkdown: body,
          bodyHtml: rendered.html,
          deliveryStatus: shouldQueue ? "QUEUED" : undefined,
        },
      });

      // One MessageMention and one MENTION notification per validated member (D-16, D-20).
      if (mentioned.length > 0) {
        await recordMentions(tx, orgId, {
          messageId: message.id,
          ticketId,
          authorUserId: session.user.id,
          members: mentioned,
        });
      }

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
      // Review WR-04: decided by the write itself under the row lock, never by the pre-read
      // above (taken before the lock), so a second concurrent first reply that waited on the
      // lock keeps the first stamp instead of overwriting it.
      if (mode === "public") {
        await tx.ticket.updateMany({
          where: { id: ticketId, organizationId: orgId, firstRespondedAt: null },
          data: { firstRespondedAt: new Date(), isAtRisk: false, isBreached: false },
        });
      }

      uploadXactId = await boundUploadCommitInTx(tx);
      commitSent = true;
      return { ok: true as const, messageId: message.id };
    });
  } catch (err) {
    if (commitSent) await queueStagedFilesAfterUncertainCommit(orgId, staged.saved, uploadXactId);
    else await staged.discard();
    throw err;
  }

  if (!outcome.ok) {
    await staged.discard();
    if (outcome.error === "MEMBERSHIP_ENDED") {
      return NextResponse.json({ error: "MEMBERSHIP_ENDED" }, { status: 403 });
    }
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
