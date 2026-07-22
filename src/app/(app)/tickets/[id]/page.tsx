import { MessageSquare } from "lucide-react";
import { Fragment } from "react";
import { EmptyState } from "@/components/empty-state";
import { AiActivitySection } from "@/components/tickets/ai-activity-section";
import type { CustomFieldInputDefinition } from "@/components/tickets/custom-field-input";
import { ThreadMessage } from "@/components/tickets/thread-message";
import { ThreadSystemEvent } from "@/components/tickets/thread-system-event";
import { TicketMetaHeader } from "@/components/tickets/ticket-meta-header";
import { TicketReplyArea } from "@/components/tickets/ticket-reply-area";
import { prisma } from "@/lib/db";
import { getScopedDb } from "@/lib/session";
import { TicketListPanel } from "../ticket-list-panel";

interface TicketDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TicketDetailPage({ params, searchParams }: TicketDetailPageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const { db, orgId } = await getScopedDb();

  const ticket = await db.ticket.findFirst({
    where: { id },
    include: {
      contact: true,
      assignee: true,
      tags: { include: { tag: true } },
      messages: {
        include: { authorUser: true, authorContact: true, attachments: true },
        orderBy: { createdAt: "asc" },
      },
      customFieldValues: { include: { definition: true } },
    },
  });

  if (!ticket) {
    return (
      <>
        <TicketListPanel searchParams={sp} selectedId={id} basePath={`/tickets/${id}`} />
        <div className="flex flex-1 items-center justify-center overflow-y-auto">
          <EmptyState
            icon={MessageSquare}
            heading="Ticket not found"
            body="This ticket may have been deleted, or you don't have access to it."
          />
        </div>
      </>
    );
  }

  // Better Auth's `member` model is excluded from scopedDb's DOMAIN_MODELS allowlist —
  // bare prisma + explicit organizationId filter, same idiom as src/lib/authz.ts.
  const [members, definitions, availableTags, auditEvents, draftableKbCount] = await Promise.all([
    prisma.member.findMany({ where: { organizationId: orgId }, include: { user: true } }),
    db.customFieldDefinition.findMany({ orderBy: { position: "asc" } }),
    db.tag.findMany({ orderBy: { name: "asc" } }),
    db.auditEvent.findMany({ where: { ticketId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.kbArticle.count({ where: { embeddingStatus: "COMPLETED" } }),
  ]);

  const customFields = definitions.map((definition) => {
    const inputDefinition: CustomFieldInputDefinition = {
      id: definition.id,
      label: definition.label,
      type: definition.type,
      options: Array.isArray(definition.options) ? (definition.options as string[]) : undefined,
    };

    const existingValue = ticket.customFieldValues.find(
      (v) => v.customFieldDefinitionId === definition.id,
    );

    const value =
      definition.type === "NUMBER"
        ? (existingValue?.valueNumber ?? null)
        : definition.type === "CHECKBOX"
          ? (existingValue?.valueBoolean ?? null)
          : definition.type === "DATE"
            ? existingValue?.valueDate
              ? existingValue.valueDate.toISOString().slice(0, 10)
              : null
            : (existingValue?.valueText ?? null);

    return { definition: inputDefinition, value };
  });

  return (
    <>
      <TicketListPanel searchParams={sp} selectedId={id} basePath={`/tickets/${id}`} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <TicketMetaHeader
          ticket={{
            id: ticket.id,
            number: ticket.number,
            subject: ticket.subject,
            status: ticket.status,
            priority: ticket.priority,
            assigneeId: ticket.assigneeId,
            firstResponseDueAt: ticket.firstResponseDueAt,
            resolutionDueAt: ticket.resolutionDueAt,
            firstRespondedAt: ticket.firstRespondedAt,
            resolvedAt: ticket.resolvedAt,
            isAtRisk: ticket.isAtRisk,
            isBreached: ticket.isBreached,
            triageCategory: ticket.triageCategory,
            triageSentiment: ticket.triageSentiment,
            triageLanguage: ticket.triageLanguage,
            triageStatus: ticket.triageStatus,
          }}
          assigneeName={ticket.assignee?.name ?? null}
          members={members.map((member) => ({ id: member.user.id, name: member.user.name }))}
          tags={ticket.tags.map((t) => ({ id: t.tag.id, name: t.tag.name }))}
          availableTags={availableTags.map((tag) => ({ id: tag.id, name: tag.name }))}
          customFields={customFields}
        />

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {ticket.messages.map((message) => (
            // Immediately after any message with triggeredReopen === true, render the
            // reopen system-event row — this is the actual consumer of the marker plan
            // 12 sets (never inferred from ticket.status/timestamps).
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
                  deliveryStatus: message.deliveryStatus,
                }}
              />
              {message.triggeredReopen && (
                <ThreadSystemEvent
                  text={`Ticket reopened — new reply from ${ticket.contact.name ?? ticket.contact.email}.`}
                />
              )}
            </Fragment>
          ))}
        </div>

        <AiActivitySection
          events={auditEvents.map((event) => ({
            id: event.id,
            actionType: event.actionType,
            provider: event.provider,
            model: event.model,
            createdAt: event.createdAt,
            output: event.output,
          }))}
        />

        <TicketReplyArea ticketId={ticket.id} canDraft={draftableKbCount > 0} />
      </div>
    </>
  );
}
