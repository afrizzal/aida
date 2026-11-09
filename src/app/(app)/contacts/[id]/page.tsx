import { Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { StateChip } from "@/components/tickets/state-chip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { loadContactDetailData } from "@/lib/contacts/contact-detail-data";
import { prisma } from "@/lib/db";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { requirePageAccess } from "@/lib/page-access";
import { e2eFault } from "@/lib/testing/e2e-fault";
import { NotesForm } from "./notes-form";

interface ContactDetailPageProps {
  params: Promise<{ id: string }>;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function ContactDetailPage({ params }: ContactDetailPageProps) {
  // The membership gate first, outside any try (Phase 10, V-27, C6): a non-member goes to /no-access.
  const { session, orgId } = await requirePageAccess();
  await e2eFault("contact-detail-page"); // inert outside the E2E server (src/lib/testing/e2e-fault.ts)
  const actor = { userId: session.user.id, orgId };
  const { id } = await params;

  // D-01 and K44: the loader checks the member row again before it reads the contact or its
  // tickets. A membership that ended between the gate and this read goes to /no-access too (V-27).
  const data = await loadContactDetailData(prisma, actor, id);

  if (data.status === "membership_ended") redirect("/no-access");

  if (data.status === "not_found") {
    return (
      <EmptyState
        icon={Users}
        headingAs="h1"
        heading="Contact not found"
        body="This contact may have been removed or belongs to a different workspace."
      />
    );
  }

  const { contact } = data;
  const displayName = contact.name ?? contact.email;

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <Avatar size="lg">
            <AvatarFallback className="bg-primary/10 text-[14px] font-medium text-primary-emphasis">
              {getInitials(displayName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 space-y-3">
            <h1 className="text-[18px] font-semibold text-foreground">{displayName}</h1>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="text-foreground">{contact.email}</dd>
              {contact.phone ? (
                <>
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd className="text-foreground">{contact.phone}</dd>
                </>
              ) : null}
              {contact.company ? (
                <>
                  <dt className="text-muted-foreground">Company</dt>
                  <dd className="text-foreground">{contact.company}</dd>
                </>
              ) : null}
            </dl>
            <NotesForm contactId={contact.id} defaultValue={contact.notes ?? ""} />
          </div>
        </div>
      </Card>

      <div>
        <h2 className="mb-2 text-[14px] font-medium text-muted-foreground">
          Tickets from {displayName}
        </h2>
        {contact.tickets.length === 0 ? (
          <p className="py-4 text-[13px] text-muted-foreground">
            No tickets from this contact yet.
          </p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border/70">
            {contact.tickets.map((ticket) => (
              <Link
                key={ticket.id}
                href={`/tickets/${ticket.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <span className="shrink-0 text-[13px] text-muted-foreground">#{ticket.number}</span>
                <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">
                  {ticket.subject}
                </span>
                {/* No tooltip: the chip sits inside the row link (UI-SPEC Surface 2). */}
                <StateChip name={ticket.state.name} colorToken={ticket.state.colorToken} />
                <span className="w-20 shrink-0 text-right text-[12px] text-muted-foreground">
                  {formatRelativeTime(ticket.createdAt)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
