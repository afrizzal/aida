import { Lightbulb } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { formatRelativeTime } from "@/lib/format-relative-time";
import type {
  SlaCsatSummary,
  StoredCluster,
  StoredKbGap,
  StoredNarrative,
  VolumeDrivers,
} from "@/lib/insight/types";
import { getScopedDb } from "@/lib/session";
import { GenerateButton } from "./generate-button";
import { KbGapsCard } from "./kb-gaps-card";
import { PeriodTabs } from "./period-tabs";
import { RecurringIssuesCard } from "./recurring-issues-card";
import { SlaCsatCard } from "./sla-csat-card";
import { VolumeDriversCard } from "./volume-drivers-card";

// Reads InsightRun rows at request time — never statically prerendered during `next build`
// (mirrors /settings and /setup's force-dynamic precedent).
export const dynamic = "force-dynamic";

const VALID_PERIODS = [7, 30, 90] as const;
type Period = (typeof VALID_PERIODS)[number];

function parsePeriod(raw: string | string[] | undefined): Period {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return (VALID_PERIODS as readonly number[]).includes(n) ? (n as Period) : 30;
}

interface InsightsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function InsightsPage({ searchParams }: InsightsPageProps) {
  const params = await searchParams;
  const period = parsePeriod(params.period);

  const { db } = await getScopedDb();

  // Latest run of any status drives the "Generating…" indicator; latest COMPLETED run is what
  // renders. When the latest run IS the completed one we reuse it — avoids a second query.
  const latest = await db.insightRun.findFirst({
    where: { periodDays: period },
    orderBy: { createdAt: "desc" },
  });
  const completed =
    latest?.status === "COMPLETED"
      ? latest
      : await db.insightRun.findFirst({
          where: { periodDays: period, status: "COMPLETED" },
          orderBy: { completedAt: "desc" },
        });
  const running = latest?.status === "PENDING" || latest?.status === "RUNNING";

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[18px] font-semibold tracking-tight text-foreground">AIDA Insight</h1>
        <PeriodTabs active={period} />
        <GenerateButton period={period} running={running} />
        <span className="ml-auto text-[13px] text-muted-foreground">
          {completed?.completedAt
            ? `Last generated ${formatRelativeTime(completed.completedAt)}`
            : "Not generated yet"}
        </span>
      </div>

      {!completed ? (
        <EmptyState
          icon={Lightbulb}
          heading="No insights yet"
          body={`Generate insights to cluster recurring issues, spot KB gaps, and summarize volume + SLA/CSAT for the last ${period} days.`}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Prisma type-erases Json columns to JsonValue — cast back to the shared contract
              (src/lib/insight/types.ts, Pitfall 5). Cards themselves handle the null (AI-off)
              and empty-array cases. */}
          <RecurringIssuesCard clusters={completed.clusters as unknown as StoredCluster[] | null} />
          <KbGapsCard gaps={completed.kbGaps as unknown as StoredKbGap[] | null} />
          <VolumeDriversCard data={completed.volumeDrivers as unknown as VolumeDrivers | null} />
          <SlaCsatCard
            data={completed.slaCsat as unknown as SlaCsatSummary | null}
            narrative={completed.narrative as unknown as StoredNarrative | null}
          />
        </div>
      )}
    </div>
  );
}
