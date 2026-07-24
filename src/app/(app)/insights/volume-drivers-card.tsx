import { Card } from "@/components/ui/card";
import type { VolumeDriverRow, VolumeDrivers } from "@/lib/insight/types";

interface VolumeDriversCardProps {
  /** null => no run data for this period at all (never null just because AI is off — SQL-only). */
  data: VolumeDrivers | null;
}

const SECTIONS: { key: keyof VolumeDrivers; label: string }[] = [
  { key: "byCategory", label: "By Category" },
  { key: "byTag", label: "By Tag" },
  { key: "byCompany", label: "By Company" },
];

function DeltaIndicator({ delta }: { delta: number }) {
  if (delta > 0) return <span className="w-8 shrink-0 text-[12px] text-success">+{delta}</span>;
  if (delta < 0) return <span className="w-8 shrink-0 text-[12px] text-warning">{delta}</span>;
  return <span className="w-8 shrink-0 text-[12px] text-muted-foreground">0</span>;
}

function DriverRow({ row, maxCount }: { row: VolumeDriverRow; maxCount: number }) {
  const width = maxCount > 0 ? Math.round((row.count / maxCount) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 truncate text-[12px] text-foreground">{row.key}</span>
      {/* CSS bar row — plain divs only, no chart library (LOCKED). */}
      <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
        <div className="h-full rounded bg-primary" style={{ width: `${width}%` }} />
      </div>
      <span className="w-6 shrink-0 text-right text-[12px] text-foreground">{row.count}</span>
      <DeltaIndicator delta={row.delta} />
    </div>
  );
}

/**
 * AIDA-17 section 3: pure SQL volume drivers (category/tag/company) with delta vs. the
 * previous equal-length period. Renders regardless of the AI toggle — no LLM involvement.
 */
export function VolumeDriversCard({ data }: VolumeDriversCardProps) {
  return (
    <Card className="border-border/70 p-5 shadow-sm">
      <h2 className="text-[14px] font-semibold text-foreground">Volume Drivers</h2>

      {data === null ? (
        <p className="mt-3 text-[13px] text-muted-foreground">Nothing to show for this period.</p>
      ) : (
        <div className="mt-3 space-y-4">
          {SECTIONS.map(({ key, label }) => {
            const rows = data[key];
            const maxCount = Math.max(1, ...rows.map((r) => r.count));
            return (
              <div key={key} className="space-y-1.5">
                <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
                {rows.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">No data.</p>
                ) : (
                  <div className="space-y-1">
                    {rows.map((row) => (
                      <DriverRow key={row.key} row={row} maxCount={maxCount} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
