import { ListOrdered } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { prisma } from "@/lib/db";
import { getSessionActor } from "@/lib/session";
import {
  MEMBERS_NOTE,
  MEMBERSHIP_ENDED,
  PAGE_EMPTY_BODY,
  PAGE_EMPTY_HEADING,
  STATUS_PAGE_DESCRIPTION,
  STATUS_PAGE_TITLE,
} from "@/lib/tickets/state-copy";
import { listStatesForSettings } from "@/lib/tickets/ticket-state-admin";
import { StatusManager } from "./status-manager";

// The Ticket statuses settings page (Phase 12.1, AIDA-97, UI-SPEC Surface 1). Reads the
// organization's states through listStatesForSettings, which checks active membership first
// (D-01): a removed member gets the membership-ended line and no data, without a throw.
export const dynamic = "force-dynamic";

export default async function TicketStatusesSettingsPage() {
  const list = await listStatesForSettings(prisma, await getSessionActor());

  if (!list.ok) {
    // AIDA-36 (D-14): the access-ended state keeps the page's one h1.
    return (
      <div className="space-y-6">
        <h1 className="text-[18px] font-semibold">{STATUS_PAGE_TITLE}</h1>
        <p className="text-[13px] text-muted-foreground">{MEMBERSHIP_ENDED}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-[18px] font-semibold">{STATUS_PAGE_TITLE}</h1>
        <p className="max-w-[640px] text-[13px] text-muted-foreground">{STATUS_PAGE_DESCRIPTION}</p>
        {!list.isAdmin && <p className="text-[13px] text-muted-foreground">{MEMBERS_NOTE}</p>}
      </div>
      {list.states.length === 0 ? (
        <EmptyState icon={ListOrdered} heading={PAGE_EMPTY_HEADING} body={PAGE_EMPTY_BODY} />
      ) : (
        <StatusManager
          states={list.states}
          defaultStateId={list.defaultStateId}
          isAdmin={list.isAdmin}
        />
      )}
    </div>
  );
}
