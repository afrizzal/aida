import type { TicketPriority } from "@/generated/prisma/client";
import { getScopedDb } from "@/lib/session";
import { SlaForm } from "./sla-form";

const PRIORITY_ORDER: TicketPriority[] = ["URGENT", "HIGH", "NORMAL", "LOW"];

// Seeded placeholder defaults (minutes), used only when no SlaPolicy row exists yet for a
// priority. NOTE: plan 02-03 (ticket-core, not a dependency of this plan) introduces a
// shared `DEFAULT_SLA_TARGETS` constant at src/lib/tickets/sla.ts for the SLA-stamping
// worker job. Wave 2 plans run independently with no cross-dependency between 02-03 and
// 02-07, so the same illustrative values (URGENT 60/480, HIGH 240/1440, NORMAL 480/2880,
// LOW 1440/4320 minutes) are duplicated here as a local literal rather than importing a
// module this plan does not own/depend on.
const DEFAULT_TARGETS_MINUTES: Record<
  TicketPriority,
  { firstResponseTargetMinutes: number; resolutionTargetMinutes: number }
> = {
  URGENT: { firstResponseTargetMinutes: 60, resolutionTargetMinutes: 480 },
  HIGH: { firstResponseTargetMinutes: 240, resolutionTargetMinutes: 1440 },
  NORMAL: { firstResponseTargetMinutes: 480, resolutionTargetMinutes: 2880 },
  LOW: { firstResponseTargetMinutes: 1440, resolutionTargetMinutes: 4320 },
};

export default async function SlaPoliciesPage() {
  const { db } = await getScopedDb();
  const policies = await db.slaPolicy.findMany();
  const policyMap = new Map(policies.map((p) => [p.priority, p]));

  const rows = PRIORITY_ORDER.map((priority) => {
    const existing = policyMap.get(priority);
    const defaults = DEFAULT_TARGETS_MINUTES[priority];
    return {
      priority,
      firstResponseHours:
        (existing?.firstResponseTargetMinutes ?? defaults.firstResponseTargetMinutes) / 60,
      resolutionHours: (existing?.resolutionTargetMinutes ?? defaults.resolutionTargetMinutes) / 60,
    };
  });

  return (
    <div className="space-y-6">
      <h1 className="text-[18px] font-semibold">SLA Policies</h1>
      <SlaForm initialRows={rows} />
    </div>
  );
}
