// The Sources card of the review page (UI-SPEC 3d, D-08, D-11). One row per source in position
// order: a same-tab link to the ticket with its status chip, the change warning, and where the
// draft cited it. Sources are internal: they are shown to the reviewer here and never rendered
// into the article. Rendered as text only; all copy comes from proposal-copy.ts.

import { Ticket, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { StateChip } from "@/components/tickets/state-chip";
import { Card } from "@/components/ui/card";
import {
  citedIn,
  NOT_CITED,
  SOURCE_CHANGED_SHORT,
  SOURCE_UNAVAILABLE,
  SOURCES_HEADING,
  SOURCES_INTERNAL_NOTE,
} from "@/lib/kb/proposal-copy";
import type { ProposalReviewSource } from "@/lib/kb/proposal-queries";

export function ProposalSourcesCard({ sources }: { sources: ProposalReviewSource[] }) {
  return (
    <Card className="gap-2 border-border/70 p-4 text-[13px] shadow-sm">
      <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
        {SOURCES_HEADING}
      </h2>
      <ul className="divide-y divide-border/70">
        {sources.map((source) => (
          <SourceRow key={`${source.position}:${source.ticketId}`} source={source} />
        ))}
      </ul>
      <p className="text-[12px] text-muted-foreground">{SOURCES_INTERNAL_NOTE}</p>
    </Card>
  );
}

function SourceRow({ source }: { source: ProposalReviewSource }) {
  const { ticket } = source;
  const label = ticket ? `#${ticket.number} ${ticket.subject}` : "";

  return (
    <li className="space-y-1 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Ticket className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {ticket ? (
          <>
            <Link
              href={`/tickets/${source.ticketId}`}
              title={label}
              className="min-w-0 max-w-[240px] truncate text-primary-emphasis hover:underline"
            >
              <span className="tabular-nums">#{ticket.number}</span> {ticket.subject}
            </Link>
            <StateChip name={ticket.stateName} colorToken={ticket.colorToken} />
          </>
        ) : (
          <span className="text-muted-foreground">{SOURCE_UNAVAILABLE}</span>
        )}
      </div>
      {source.changed && (
        <p className="flex items-center gap-1 text-[12px] text-foreground">
          <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
          {SOURCE_CHANGED_SHORT}
        </p>
      )}
      <p className="text-[12px] text-muted-foreground">
        {source.citedSections.length > 0 ? citedIn(source.citedSections.join(", ")) : NOT_CITED}
      </p>
    </li>
  );
}
