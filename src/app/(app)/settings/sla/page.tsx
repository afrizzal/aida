import type { TicketPriority } from "@/generated/prisma/client";
import { getOrgRole } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/membership";
import { requirePageAccess } from "@/lib/page-access";
import { readAutoCloseSettings } from "@/lib/tickets/auto-close-settings";
import { DEFAULT_SLA_TARGETS } from "@/lib/tickets/sla";
import { AutoCloseForm } from "./auto-close-form";
import { SlaForm } from "./sla-form";

const PRIORITY_ORDER: TicketPriority[] = ["URGENT", "HIGH", "NORMAL", "LOW"];

export default async function SlaPoliciesPage() {
  // The membership gate first, outside any try (Phase 10, V-27, C6): a non-member goes to /no-access.
  const { db, orgId } = await requirePageAccess();
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

  // Auto-close card (Phase 11, AIDA-51): stored values, editable by owners and admins only.
  const autoClose = await readAutoCloseSettings(prisma, orgId);
  const role = await getOrgRole();
  const canEdit = isAdminRole(role);

  return (
    <div className="space-y-6">
      <h1 className="text-[18px] font-semibold">SLA Policies</h1>
      <SlaForm initialRows={rows} />
      <AutoCloseForm initialDays={autoClose.days} canEdit={canEdit} />
    </div>
  );
}
