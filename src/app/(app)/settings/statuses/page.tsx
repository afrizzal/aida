import { ListOrdered } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { StateChip } from "@/components/tickets/state-chip";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { getSessionActor } from "@/lib/session";
import {
  DEFAULT_BADGE,
  GROUP_DESCRIPTIONS,
  GROUP_LABELS,
  MEMBERS_NOTE,
  MEMBERSHIP_ENDED,
  PAGE_EMPTY_BODY,
  PAGE_EMPTY_HEADING,
  STATE_GROUP_KEYS,
  STATUS_PAGE_DESCRIPTION,
  STATUS_PAGE_TITLE,
  ticketCountLabel,
} from "@/lib/tickets/state-copy";
import { listStatesForSettings } from "@/lib/tickets/ticket-state-admin";

// The Ticket statuses settings page (Phase 12.1, AIDA-97, UI-SPEC Surface 1). Reads the
// organization's states through listStatesForSettings, which checks active membership first
// (D-01): a removed member gets the membership-ended line and no data, without a throw.
export const dynamic = "force-dynamic";

export default async function TicketStatusesSettingsPage() {
  const list = await listStatesForSettings(prisma, await getSessionActor());

  if (!list.ok) {
    return <p className="text-[13px] text-muted-foreground">{MEMBERSHIP_ENDED}</p>;
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
        <div className="space-y-4">
          {STATE_GROUP_KEYS.map((group) => (
            <Card key={group} className="border-border/70 p-0 shadow-sm">
              <section aria-labelledby={`group-${group}-heading`}>
                <div className="flex items-start justify-between gap-4 border-b border-border/70 p-4">
                  <div className="space-y-1">
                    <h2
                      id={`group-${group}-heading`}
                      className="text-[15px] font-semibold tracking-tight"
                    >
                      {GROUP_LABELS[group]}
                    </h2>
                    <p className="text-[12px] text-muted-foreground">{GROUP_DESCRIPTIONS[group]}</p>
                  </div>
                </div>
                <ol
                  aria-labelledby={`group-${group}-heading`}
                  className="divide-y divide-border/70"
                >
                  {list.states
                    .filter((s) => s.group === group)
                    .map((s) => (
                      <li
                        key={s.id}
                        className="flex min-h-12 flex-wrap items-center gap-2 px-4 py-2"
                      >
                        <StateChip name={s.name} colorToken={s.colorToken} />
                        {s.id === list.defaultStateId && (
                          <Badge variant="secondary" className="h-5 px-2 text-[12px]">
                            {DEFAULT_BADGE}
                          </Badge>
                        )}
                        <span className="text-[12px] text-muted-foreground tabular-nums">
                          {ticketCountLabel(s.ticketCount)}
                        </span>
                      </li>
                    ))}
                </ol>
              </section>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
