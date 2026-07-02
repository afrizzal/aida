import { Users } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { StatusChip } from "@/components/tickets/status-chip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { getScopedDb } from "@/lib/session";
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
  const { db } = await getScopedDb();
  const { id } = await params;

  const contact = await db.contact.findFirst({
    where: { id },
    include: {
      tickets: {
        orderBy: { createdAt: "desc" },
        select: { id: true, number: true, subject: true, status: true, createdAt: true },
      },
    },
  });

  if (!contact) {
    return (
      <EmptyState
        icon={Users}
        heading="Contact not found"
        body="This contact may have been removed or belongs to a different workspace."
      />
    );
  }

  const displayName = contact.name ?? contact.email;

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <Avatar size="lg">
            <AvatarFallback className="bg-primary/10 text-[14px] font-medium text-primary">
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
                <span className="shrink-0 text-[13px] text-muted-foreground">
                  #{ticket.number}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">
                  {ticket.subject}
                </span>
                <StatusChip status={ticket.status} />
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
