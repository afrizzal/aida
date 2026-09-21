import { ArrowUpRight, Merge } from "lucide-react";
import Link from "next/link";
import { LocalDateTime } from "@/components/tickets/local-date-time";
import { Button } from "@/components/ui/button";

export interface MergeTargetRef {
  id: string;
  number: number;
}

/**
 * UI-SPEC 3b (D-08): shown on a merged source between the meta header and the feed. A target
 * that is not readable (should not happen inside one organization) gives the form without a link.
 */
export function MergedSourceBanner({
  target,
  mergedAt,
}: {
  target: MergeTargetRef | null;
  mergedAt: Date | null;
}) {
  const date = mergedAt ? <LocalDateTime value={mergedAt} /> : "an earlier date";
  return (
    <div
      role="note"
      className="mx-6 mt-4 flex items-start gap-2 rounded-lg border border-border/70 bg-muted p-4 text-[13px] text-foreground"
    >
      <Merge aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      {target ? (
        <>
          <p className="min-w-0 flex-1">
            This ticket was merged into{" "}
            <Link
              href={`/tickets/${target.id}`}
              className="font-semibold tabular-nums hover:text-primary-emphasis hover:underline"
            >
              #{target.number}
            </Link>{" "}
            on {date}. Its conversation continues there.
          </p>
          <Button asChild variant="ghost" size="sm" className="shrink-0 gap-2 text-[13px]">
            <Link href={`/tickets/${target.id}`}>
              <ArrowUpRight aria-hidden className="size-4" />
              Open #{target.number}
            </Link>
          </Button>
        </>
      ) : (
        <p className="min-w-0 flex-1">This ticket was merged into another ticket on {date}.</p>
      )}
    </div>
  );
}

/** UI-SPEC 3c: replaces the composer on a merged source (the server refuses replies too, 12-03). */
export function MergedComposerLine({ target }: { target: MergeTargetRef | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-6 py-4 text-[13px] text-muted-foreground">
      {target ? (
        <>
          <p className="min-w-0">
            Replies go on #{target.number}, where this conversation continues.
          </p>
          <Button asChild variant="outline" size="sm" className="text-[13px]">
            <Link href={`/tickets/${target.id}`}>Open #{target.number}</Link>
          </Button>
        </>
      ) : (
        <p className="min-w-0">Replies go on the ticket this one was merged into.</p>
      )}
    </div>
  );
}
