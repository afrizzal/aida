import { Sparkles } from "lucide-react";
import type { AuditActionType } from "@/generated/prisma/client";
import { formatRelativeTime } from "@/lib/format-relative-time";

export interface AiActivityEvent {
  id: string;
  actionType: AuditActionType;
  provider: string;
  model: string;
  createdAt: Date | string;
  output: string;
}

/** Human-readable label per AuditActionType — falls back to "AI" for any future action type. */
const ACTION_LABELS: Record<AuditActionType, string> = {
  TRIAGE: "Triage",
  DRAFT_GENERATED: "Draft generated",
  DRAFT_APPROVED: "Draft approved",
};

/**
 * Defensive parse of the AuditEvent's redacted output — never throws on malformed JSON.
 * Each actionType has its own output shape (triage's category/priority/sentiment/language vs.
 * a draft's grounded/citations vs. a plain approval marker), so the actionType selects how to
 * summarize it.
 */
function formatResult(actionType: AuditActionType, output: string): string {
  try {
    const parsed: unknown = JSON.parse(output);
    if (actionType === "DRAFT_GENERATED") {
      const r = parsed as { grounded?: boolean; citations?: unknown[] };
      if (r.grounded === false) return "Not grounded";
      const count = Array.isArray(r.citations) ? r.citations.length : 0;
      return `Grounded · ${count} citation${count === 1 ? "" : "s"}`;
    }
    if (actionType === "DRAFT_APPROVED") {
      const r = parsed as { approved?: boolean };
      return r.approved ? "Approved" : "—";
    }
    const r = parsed as {
      category?: string;
      priority?: string;
      sentiment?: string;
      language?: string;
    };
    return [r.category, r.priority, r.sentiment, r.language].filter(Boolean).join(" · ") || "—";
  } catch {
    return "—";
  }
}

/**
 * Read-only, server-safe "AI Activity" log of triage runs (AIDA-19/D-19) — a native <details>
 * so it needs no client JS. Deliberately never renders AuditEvent.input (D-13: it may contain
 * redacted ticket content) — model/time/result only. Renders nothing on a never-triaged ticket.
 */
export function AiActivitySection({ events }: { events: AiActivityEvent[] }) {
  if (events.length === 0) return null;

  return (
    <details className="border-t border-border/70 px-6 py-3 text-[12px] text-muted-foreground">
      <summary className="flex cursor-pointer select-none items-center gap-1.5">
        <Sparkles className="size-3.5" />
        AI Activity
        <span className="text-muted-foreground/70">({events.length})</span>
      </summary>
      <div className="mt-2 space-y-1.5">
        {events.map((event) => (
          <div key={event.id} className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-foreground">
              {ACTION_LABELS[event.actionType] ?? "AI"}
            </span>
            <span>
              {event.provider} · {event.model}
            </span>
            <span>{formatRelativeTime(event.createdAt)}</span>
            <span>{formatResult(event.actionType, event.output)}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
