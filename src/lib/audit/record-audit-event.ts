// The ONE write path into AuditEvent. `input` MUST already be redacted (pass complete()'s
// redactedPrompt, never raw ticket text). This module only ever INSERTs — the append-only
// Postgres trigger (aida_audit_event_immutable, 04-01) would reject an UPDATE/DELETE anyway,
// but this module never attempts one.
//
// Relative imports only (no `@/`) — worker-bundleable via esbuild (the ai-triage job, 04-05,
// bundles this module).
import type { scopedDb } from "../scoped-db";

/** Narrowed to just the delegate this module needs (mirrors src/lib/llm/settings.ts's SettingDb precedent). */
export type AuditDb = Pick<ReturnType<typeof scopedDb>, "auditEvent">;

export interface RecordAuditEventParams {
  actionType: "TRIAGE"; // widen as Phase 5/6 add DRAFT_GENERATED/DRAFT_APPROVED/INSIGHT_RUN
  ticketId?: string | null;
  messageId?: string | null;
  provider: string;
  model: string;
  /** MUST be the already-redacted prompt (never raw ticket text) — D-13. */
  input: string;
  /** JSON.stringify of the model output. */
  output: string;
}

/**
 * Inserts one AuditEvent row. organizationId is auto-injected by scopedDb's create hook;
 * the explicit cast below matches the create-ticket.ts precedent — Prisma's generated
 * *UncheckedCreateInput type still lists organizationId statically even though scopedDb
 * injects it at runtime. Never logs `input`/`output` (they may contain ticket content).
 */
export async function recordAuditEvent(db: AuditDb, params: RecordAuditEventParams): Promise<void> {
  await (db.auditEvent.create as (a: { data: Record<string, unknown> }) => Promise<{ id: string }>)(
    {
      data: {
        actionType: params.actionType,
        ticketId: params.ticketId ?? null,
        messageId: params.messageId ?? null,
        provider: params.provider,
        model: params.model,
        input: params.input,
        output: params.output,
      },
    },
  );
}
