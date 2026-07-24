import { Fragment } from "react";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { StatusChip } from "@/components/tickets/status-chip";
import { ThreadMessage } from "@/components/tickets/thread-message";
import { ThreadSystemEvent } from "@/components/tickets/thread-system-event";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { CsatForm } from "./csat-form";
import { FollowUpForm } from "./follow-up-form";

// Always server-render: the thread must reflect the latest PUBLIC messages on every
// visit (including right after a follow-up triggers router.refresh()) — no static
// prerender for a bearer-token-authorized route.
export const dynamic = "force-dynamic";

interface StatusPageProps {
  params: Promise<{ token: string }>;
}

export default async function StatusPage({ params }: StatusPageProps) {
  const { token } = await params;

  // Unauthenticated bearer-token flow — the token IS the authorization, so this uses
  // bare `prisma`, never scopedDb (no session/org context exists here). The
  // `where: { visibility: "PUBLIC" }` filter is mandatory and server-side: internal
  // notes must NEVER be fetched for this route (D-21), let alone filtered client-side.
  const ticket = await prisma.ticket.findUnique({
    where: { statusToken: token },
    include: {
      contact: true,
      csatResponse: true,
      messages: {
        where: { visibility: "PUBLIC" },
        include: { attachments: true, authorUser: true, authorContact: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!ticket) {
    return (
      <PublicPageShell maxWidth={720}>
        <div className="space-y-4 text-center">
          <h1 className="text-[18px] font-semibold">We couldn't find that ticket</h1>
          <p className="text-[14px] text-muted-foreground">
            This status link may be invalid or expired. If you need help, please submit a new
            request.
          </p>
          <Button asChild className="w-full">
            <a href="/request">Submit a new request</a>
          </Button>
        </div>
      </PublicPageShell>
    );
  }

  return (
    <PublicPageShell maxWidth={720}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="truncate text-[18px] font-semibold">
          #{ticket.number} {ticket.subject}
        </h1>
        <StatusChip status={ticket.status} />
      </div>

      <div className="space-y-4">
        {ticket.messages.map((message) => (
          // Immediately after any public message with triggeredReopen === true, render
          // the reopen system-event row — this is the customer-facing consumer of the
          // marker the follow-up route (Task 2) sets server-side (never inferred here
          // from ticket.status/timestamps).
          <Fragment key={message.id}>
            <ThreadMessage
              message={{
                id: message.id,
                visibility: message.visibility,
                authorContactId: message.authorContactId,
                bodyHtml: message.bodyHtml,
                createdAt: message.createdAt,
                authorUser: message.authorUser ? { name: message.authorUser.name } : null,
                authorContact: message.authorContact
                  ? { name: message.authorContact.name, email: message.authorContact.email }
                  : null,
                attachments: message.attachments.map((attachment) => ({
                  id: attachment.id,
                  originalFilename: attachment.originalFilename,
                  sizeBytes: attachment.sizeBytes,
                })),
              }}
              attachmentHrefBase={`/api/public/status/${token}/attachments`}
            />
            {message.triggeredReopen && (
              <ThreadSystemEvent
                text={`Ticket reopened — new reply from ${ticket.contact.name ?? ticket.contact.email}.`}
              />
            )}
          </Fragment>
        ))}
      </div>

      <div className="mt-6 border-t border-border pt-4">
        <FollowUpForm token={token} />
      </div>

      {(ticket.status === "RESOLVED" || ticket.status === "CLOSED") && (
        <div className="mt-6 border-t border-border pt-4">
          <h2 className="mb-2 text-[14px] font-semibold">How did we do?</h2>
          <CsatForm
            token={token}
            existingScore={ticket.csatResponse?.score ?? null}
            existingComment={ticket.csatResponse?.comment ?? null}
          />
        </div>
      )}
    </PublicPageShell>
  );
}
