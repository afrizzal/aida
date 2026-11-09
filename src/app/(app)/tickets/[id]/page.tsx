import { MessageSquare } from "lucide-react";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { ActivityFeed } from "@/components/tickets/activity-feed";
import { AiActivitySection } from "@/components/tickets/ai-activity-section";
import type { CustomFieldInputDefinition } from "@/components/tickets/custom-field-input";
import { MergedComposerLine, MergedSourceBanner } from "@/components/tickets/merged-source-banner";
import { SnoozeControl } from "@/components/tickets/snooze-control";
import { TicketMetaHeader } from "@/components/tickets/ticket-meta-header";
import { TicketReplyArea } from "@/components/tickets/ticket-reply-area";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/membership";
import { requirePageAccess } from "@/lib/page-access";
import { e2eFault } from "@/lib/testing/e2e-fault";
import { loadTicketDetailData } from "@/lib/tickets/ticket-detail-data";
import { TicketListPanel } from "../ticket-list-panel";

interface TicketDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TicketDetailPage({ params, searchParams }: TicketDetailPageProps) {
  // The membership gate first, outside any try (Phase 10, V-27, C6): a non-member goes to /no-access.
  const { session, orgId, role, db } = await requirePageAccess();
  await e2eFault("ticket-detail-page"); // inert outside the E2E server (src/lib/testing/e2e-fault.ts)
  const { id } = await params;
  const sp = await searchParams;
  const actor = { userId: session.user.id, orgId };

  // The loader checks the actor's member row again before the ticket is read (D-01, Codex diff
  // critique round 2 E1). A membership that ended between the gate and this read goes to
  // /no-access as well, so every protected page behaves the same (V-27).
  const detail = await loadTicketDetailData(prisma, actor, id);

  if (detail.status === "membership_ended") redirect("/no-access");

  if (detail.status === "not_found") {
    return (
      <>
        <TicketListPanel searchParams={sp} selectedId={id} basePath={`/tickets/${id}`} />
        <div className="flex flex-1 items-center justify-center overflow-y-auto">
          <EmptyState
            icon={MessageSquare}
            headingAs="h1"
            heading="Ticket not found"
            body="This ticket may have been deleted, or you don't have access to it."
          />
        </div>
      </>
    );
  }

  const {
    ticket,
    members,
    definitions,
    availableTags,
    auditEvents,
    draftableKbCount,
    relations,
    hasReceivedMerges,
    mergeTarget,
    movedFromSources,
    feed,
    feedReferences,
    stateOptions,
  } = detail;
  const isMergedSource = ticket.mergedIntoTicketId !== null;

  // 12.2 UI-SPEC 1a (D-01, D-09): the "Propose KB article…" menu item is for owners and admins
  // only, and is disabled while AI is off. Both flags are read here, after the membership check
  // above; the menu only hides or explains the entry, and requestProposalAction decides again.
  // The role is the gate's conservative read (findConservativeMembership) in exactly orgId.
  const isAdmin = isAdminRole(role);
  const aiSetting = isAdmin
    ? await db.setting.findFirst({
        where: { organizationId: orgId, key: "aiEnabled" },
        select: { value: true },
      })
    : null;
  // On only when the setting is exactly 'true', the request's own rule (D-09).
  const aiEnabled = aiSetting?.value === "true";

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
            state: ticket.state,
            slaPausedAt: ticket.slaPausedAt,
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
          states={stateOptions}
          assigneeName={ticket.assignee?.name ?? null}
          members={members.map((member) => ({ id: member.user.id, name: member.user.name }))}
          tags={ticket.tags.map((t) => ({ id: t.tag.id, name: t.tag.name }))}
          availableTags={availableTags.map((tag) => ({ id: tag.id, name: tag.name }))}
          customFields={customFields}
          relations={relations.map((relation) => ({
            relationId: relation.relationId,
            label: relation.label,
            otherTicketId: relation.otherTicketId,
            number: relation.number,
            subject: relation.subject,
            locked: relation.locked,
          }))}
          mergedSource={isMergedSource}
          hasReceivedMerges={hasReceivedMerges}
          isAdmin={isAdmin}
          aiEnabled={aiEnabled}
          snoozeControl={
            <SnoozeControl
              ticketId={ticket.id}
              group={ticket.state.group}
              snoozedUntil={ticket.snoozedUntil ? ticket.snoozedUntil.toISOString() : null}
              mergedSource={isMergedSource}
            />
          }
        />

        {isMergedSource && <MergedSourceBanner target={mergeTarget} mergedAt={ticket.mergedAt} />}

        <ActivityFeed
          feed={feed}
          ticketId={ticket.id}
          references={feedReferences}
          movedFromSources={movedFromSources}
          reopenText={`Ticket reopened — new reply from ${ticket.contact.name ?? ticket.contact.email}.`}
        />

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

        {/* UI-SPEC 3c: "Replies go on #" the target; the agent messages route refuses a merged
            source too (409 MERGED_SOURCE, 12-03). */}
        {isMergedSource ? (
          <MergedComposerLine target={mergeTarget} />
        ) : (
          <TicketReplyArea ticketId={ticket.id} canDraft={draftableKbCount > 0} />
        )}
      </div>
    </>
  );
}
