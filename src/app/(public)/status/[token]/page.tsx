import { Merge } from "lucide-react";
import { Fragment } from "react";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { PublicGroupChip } from "@/components/tickets/public-group-chip";
import { ThreadMessage } from "@/components/tickets/thread-message";
import { ThreadSystemEvent } from "@/components/tickets/thread-system-event";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadPublicBrand } from "@/lib/branding/public-brand";
import { prisma } from "@/lib/db";
import { loadStatusPageData } from "@/lib/tickets/status-page-data";
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

  // Unauthenticated bearer-token flow — the token IS the authorization. Everything the page
  // shows comes from the one loader: messages are filtered server-side by the shared
  // provenance predicate (INTERNAL notes are never fetched, D-21; per-token provenance after a
  // merge, D-09), and a merged source never exposes its target's number, subject or state.
  const ticket = await loadStatusPageData(token);

  // An invalid token renders no brand row at all (no logo, name, icon or "AIDA"), so the answer
  // is the same whatever organizations exist (D-10).
  if (!ticket) {
    return (
      <PublicPageShell maxWidth={720} brand={null}>
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

  // A valid token shows the brand of the ticket's own organization (D-10). Unauthenticated route:
  // no session or scopedDb; organization is a Better Auth model, read with bare prisma.
  const org = await prisma.organization.findUnique({
    where: { id: ticket.organizationId },
    select: { id: true, name: true },
  });
  const brand = await loadPublicBrand(org);

  return (
    <PublicPageShell maxWidth={720} brand={brand}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="truncate text-[18px] font-semibold">
          #{ticket.number} {ticket.subject}
        </h1>
        {/* UI-SPEC Surface 7 (D-09): a merged source shows the neutral "Combined" label and a
            fixed notice; nothing about the target (number, subject, group, date, count, link).
            Otherwise the fixed public label of the ticket's group (Phase 12.1, D-13, UI-SPEC
            Surface 6): only the group reaches the chip, never an internal state name. */}
        {ticket.merged ? (
          <Badge className="h-5 shrink-0 border border-border bg-muted px-2 py-0 text-[12px] text-muted-foreground">
            Combined
          </Badge>
        ) : (
          <PublicGroupChip group={ticket.group} />
        )}
      </div>

      {ticket.merged && (
        <div
          role="note"
          className="mb-4 flex items-start gap-2 rounded-lg border border-border/70 bg-muted p-4 text-[13px] text-foreground"
        >
          {/* A 20px box, the height of one 13px line, aligns the icon (review UI-IN-05). */}
          <span className="flex h-5 shrink-0 items-center">
            <Merge aria-hidden className="size-4 text-muted-foreground" />
          </span>
          <p className="min-w-0">
            This request was combined with another one of yours. New messages in the combined
            request, including any you send here, also appear on this page.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {ticket.messages.map((message) => (
          // Immediately after any public message with triggeredReopen === true, render
          // the reopen system-event row — this is the customer-facing consumer of the
          // marker the follow-up route (Task 2) sets server-side (never inferred here
          // from ticket.group/timestamps).
          <Fragment key={message.id}>
            <ThreadMessage
              message={{
                id: message.id,
                visibility: message.visibility,
                authorContactId: message.authorContactId,
                bodyHtml: message.bodyHtml,
                createdAt: message.createdAt,
                authorUser: message.authorUser,
                authorContact: message.authorContact,
                attachments: message.attachments,
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

      {/* The CSAT section shows for the same two groups the CSAT route accepts (D-11, D-02). */}
      {(ticket.group === "RESOLVED" || ticket.group === "CLOSED") && (
        <div className="mt-6 border-t border-border pt-4">
          <h2 className="mb-2 text-[14px] font-semibold">How did we do?</h2>
          <CsatForm
            token={token}
            existingScore={ticket.csat?.score ?? null}
            existingComment={ticket.csat?.comment ?? null}
          />
        </div>
      )}
    </PublicPageShell>
  );
}
