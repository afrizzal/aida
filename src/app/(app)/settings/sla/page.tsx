import type { TicketPriority } from "@/generated/prisma/client";
import { getScopedDb } from "@/lib/session";
import { DEFAULT_SLA_TARGETS } from "@/lib/tickets/sla";
import { SlaForm } from "./sla-form";

const PRIORITY_ORDER: TicketPriority[] = ["URGENT", "HIGH", "NORMAL", "LOW"];

export default async function SlaPoliciesPage() {
  const { db } = await getScopedDb();
  const policies = await db.slaPolicy.findMany();
  const policyMap = new Map(policies.map((p) => [p.priority, p]));

  const rows = PRIORITY_ORDER.map((priority) => {
    const existing = policyMap.get(priority);
    const defaults = DEFAULT_SLA_TARGETS[priority];
    return {
      priority,
      firstResponseHours:
        (existing?.firstResponseTargetMinutes ?? defaults.firstResponseMinutes) / 60,
      resolutionHours: (existing?.resolutionTargetMinutes ?? defaults.resolutionMinutes) / 60,
    };
  });

  return (
    <div className="space-y-6">
      <h1 className="text-[18px] font-semibold">SLA Policies</h1>
      <SlaForm initialRows={rows} />
    </div>
  );
}
