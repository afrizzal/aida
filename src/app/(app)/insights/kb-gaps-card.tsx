import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { StoredKbGap } from "@/lib/insight/types";

interface KbGapsCardProps {
  /** null => AI is off (KB-gap detection never ran); [] => AI on but zero clusters reported. */
  gaps: StoredKbGap[] | null;
}

/**
 * AIDA-17 section 2: recurring clusters whose best KB coverage < gapThreshold. `coverage ===
 * null` is a distinct signal (the org has zero embedded KB chunks at all — LOCKED, not an
 * error) from a low-but-present coverage score.
 */
export function KbGapsCard({ gaps }: KbGapsCardProps) {
  return (
    <Card className="border-border/70 p-5 shadow-sm">
      <h2 className="text-[14px] font-semibold text-foreground">Knowledge-Base Gaps</h2>

      {gaps === null ? (
        <p className="mt-3 text-[13px] text-muted-foreground">
          AI is off — configure a provider in Settings to see this.
        </p>
      ) : gaps.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted-foreground">Nothing to show for this period.</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {gaps.map((gap) => (
            <li key={gap.clusterIndex} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <p className="text-[14px] font-medium text-foreground">{gap.label}</p>
                <Badge variant="warning" className="h-5 px-2 text-[12px]">
                  Gap
                </Badge>
              </div>

              {gap.coverage === null ? (
                <p className="text-[13px] text-muted-foreground">
                  No KB articles exist yet — every recurring theme is a gap.
                </p>
              ) : gap.nearestArticle ? (
                <p className="text-[13px] text-muted-foreground">
                  Nearest article:{" "}
                  <Link
                    href={`/kb/${gap.nearestArticle.articleId}`}
                    className="text-primary hover:underline"
                  >
                    {gap.nearestArticle.title}
                  </Link>{" "}
                  ({(gap.nearestArticle.score * 100).toFixed(0)}% match)
                </p>
              ) : null}

              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {gap.citations.map((citation) => (
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
