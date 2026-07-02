import { Users } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { getScopedDb } from "@/lib/session";
import { ContactSearch } from "./contact-search";

interface ContactsPageProps {
  searchParams: Promise<{ q?: string }>;
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

export default async function ContactsPage({ searchParams }: ContactsPageProps) {
  const { db } = await getScopedDb();
  const { q } = await searchParams;

  const contacts = await db.contact.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { company: { contains: q, mode: "insensitive" } },
          ],
        }
      : {},
    include: { _count: { select: { tickets: true } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return (
    <div className="flex flex-col">
      <div className="px-6 py-4">
        <ContactSearch defaultValue={q ?? ""} />
      </div>

      {contacts.length === 0 ? (
        <EmptyState
          icon={Users}
          heading="No contacts yet"
          body="Contacts are created automatically when someone submits a ticket. They'll show up here once your first request comes in."
        />
      ) : (
        <div className="divide-y divide-border">
          {contacts.map((contact) => {
            const displayName = contact.name ?? contact.email;
            const ticketCount = contact._count.tickets;
            return (
              <Link
                key={contact.id}
                href={`/contacts/${contact.id}`}
                className="flex items-center gap-3 px-6 py-3 transition-colors hover:bg-muted/50"
              >
                <Avatar>
                  <AvatarFallback className="bg-primary/10 text-[12px] font-medium text-primary">
                    {getInitials(displayName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-foreground">{displayName}</p>
                  <p className="truncate text-[12px] text-muted-foreground">{contact.email}</p>
                </div>
                {contact.company ? (
                  <p className="hidden truncate text-[12px] text-muted-foreground md:block md:max-w-[160px]">
                    {contact.company}
                  </p>
                ) : null}
                <Badge variant="secondary" className="shrink-0">
                  {ticketCount} {ticketCount === 1 ? "ticket" : "tickets"}
                </Badge>
                <span className="w-24 shrink-0 text-right text-[12px] text-muted-foreground">
                  {formatRelativeTime(contact.updatedAt)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
