import { CircleAlert } from "lucide-react";
import { formatRelativeTime } from "@/lib/format-relative-time";

interface EmailHealthLineProps {
  lastPollAt: string | null;
  lastPollError: string | null;
}

/**
 * Renders inbound-poll health (D-25) in the IMAP section — failures are surfaced, never silent.
 * Presentational only: three states (failing / healthy-ever-polled / healthy-never-polled).
 */
export function EmailHealthLine({ lastPollAt, lastPollError }: EmailHealthLineProps) {
  if (lastPollError) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-[13px] text-destructive">
        <CircleAlert className="size-4" />
        Last poll failed: {lastPollError}
      </div>
    );
  }

  if (lastPollAt) {
    return (
      <p className="text-[12px] text-muted-foreground">
        Last checked {formatRelativeTime(lastPollAt)}
      </p>
    );
  }

  return (
    <p className="text-[12px] text-muted-foreground">
      Not checked yet — the inbound poll runs every minute once enabled.
    </p>
  );
}
