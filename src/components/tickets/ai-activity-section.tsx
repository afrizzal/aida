import { Sparkles } from "lucide-react";
import { formatRelativeTime } from "@/lib/format-relative-time";

export interface AiActivityEvent {
  id: string;
  provider: string;
  model: string;
  createdAt: Date | string;
  output: string;
}

/** Defensive parse of the AuditEvent's redacted output — never throws on malformed JSON. */
function formatResult(output: string): string {
  try {
    const r = JSON.parse(output) as {
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
            <span className="font-medium text-foreground">Triage</span>
            <span>
              {event.provider} · {event.model}
            </span>
            <span>{formatRelativeTime(event.createdAt)}</span>
            <span>{formatResult(event.output)}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
