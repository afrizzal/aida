import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { StoredCluster } from "@/lib/insight/types";

interface RecurringIssuesCardProps {
  /** null => AI is off (clustering never ran); [] => AI on but no cluster reached minClusterSize. */
  clusters: StoredCluster[] | null;
}

/**
 * AIDA-17 section 1: recurring-issue clusters. Citations are always attached
 * programmatically by the orchestrator (leaderCluster's memberIds) — the LLM only ever
 * supplied `label`/`description`, never ticket ids (D-16 structural guarantee).
 */
export function RecurringIssuesCard({ clusters }: RecurringIssuesCardProps) {
  return (
    <Card className="border-border/70 p-5 shadow-sm">
      <h2 className="text-[14px] font-semibold text-foreground">Recurring Issues</h2>

      {clusters === null ? (
        <p className="mt-3 text-[13px] text-muted-foreground">
          AI is off — configure a provider in Settings to see this.
        </p>
      ) : clusters.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted-foreground">Nothing to show for this period.</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {clusters.map((cluster) => (
            <li key={cluster.index} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <p className="text-[14px] font-medium text-foreground">{cluster.label}</p>
                <Badge variant="secondary" className="h-5 px-2 text-[12px]">
                  {cluster.size} tickets
                </Badge>
              </div>
              <p className="text-[13px] text-muted-foreground">{cluster.description}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {cluster.citations.map((citation) => (
                  <Link
                    key={citation.ticketId}
                    href={`/tickets/${citation.ticketId}`}
                    className="max-w-[220px] truncate text-[12px] text-primary hover:underline"
                  >
                    #{citation.number} {citation.subject}
                  </Link>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
