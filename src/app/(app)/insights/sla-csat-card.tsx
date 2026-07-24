import { Card } from "@/components/ui/card";
import type { SlaCsatSummary, StoredNarrative } from "@/lib/insight/types";

interface SlaCsatCardProps {
  /** null => no run data for this period at all (never null just because AI is off — SQL-only). */
  data: SlaCsatSummary | null;
  /** null => AI is off (narrative never ran) — numbers above still render from `data`. */
  narrative: StoredNarrative | null;
}

/** Formats a duration in seconds as "Xh Ym" (or "Ym" under an hour); "—" when unavailable. */
function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/**
 * AIDA-17 section 4: SQL-only SLA/CSAT numbers, with an optional AI narrative rendered in a
 * clearly-labeled adjacent panel. Numbers always come from `data` (the stored SQL aggregates)
 * — never parsed from `narrative.summary` (LOCKED).
 */
export function SlaCsatCard({ data, narrative }: SlaCsatCardProps) {
  return (
    <Card className="border-border/70 p-5 shadow-sm">
      <h2 className="text-[14px] font-semibold text-foreground">SLA & CSAT</h2>

      {data === null ? (
        <p className="mt-3 text-[13px] text-muted-foreground">Nothing to show for this period.</p>
      ) : (
        <div className="mt-3 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="text-[12px] text-muted-foreground">Breach rate</p>
              <p className="text-[14px] font-medium text-foreground">
                {(data.sla.breachRate * 100).toFixed(0)}%
              </p>
            </div>
            <div>
              <p className="text-[12px] text-muted-foreground">At risk</p>
              <p className="text-[14px] font-medium text-foreground">{data.sla.atRiskOnly}</p>
            </div>
            <div>
              <p className="text-[12px] text-muted-foreground">Avg first response</p>
              <p className="text-[14px] font-medium text-foreground">
                {formatDuration(data.sla.avgFirstResponseSeconds)}
              </p>
            </div>
            <div>
              <p className="text-[12px] text-muted-foreground">Avg resolution</p>
              <p className="text-[14px] font-medium text-foreground">
                {formatDuration(data.sla.avgResolutionSeconds)}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-[12px] font-medium text-muted-foreground">
              CSAT
              {data.csat.averageScore !== null
                ? ` — avg ${data.csat.averageScore.toFixed(1)} (${data.csat.responseCount} responses)`
                : " — no responses yet"}
            </p>
            <div className="space-y-1">
              {data.csat.distribution.map((bucket) => {
                const maxCount = Math.max(1, ...data.csat.distribution.map((b) => b.count));
                const width = Math.round((bucket.count / maxCount) * 100);
                return (
                  <div key={bucket.score} className="flex items-center gap-2">
                    <span className="w-8 shrink-0 text-[12px] text-foreground">
                      {bucket.score}★
                    </span>
                    {/* CSS bar row — plain divs only, no chart library (LOCKED). */}
                    <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                      <div className="h-full rounded bg-primary" style={{ width: `${width}%` }} />
                    </div>
                    <span className="w-6 shrink-0 text-right text-[12px] text-foreground">
                      {bucket.count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {narrative && (
            <div className="rounded-lg border border-primary/15 bg-accent/40 p-3">
              <p className="mb-1 text-[12px] font-medium uppercase tracking-wide text-primary">
                AI summary
              </p>
              <p className="text-[13px] text-foreground">{narrative.summary}</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
