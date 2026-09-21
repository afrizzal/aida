import { Fragment } from "react";
import { ThreadMessage } from "@/components/tickets/thread-message";
import { ThreadSystemEvent } from "@/components/tickets/thread-system-event";
import type { FeedItem } from "@/lib/tickets/activity-feed";
import type {
  FeedAuditEvent,
  FeedReferences,
  TicketDetail,
} from "@/lib/tickets/ticket-detail-data";

// UI-SPEC Surface 6 (D-18, AIDA-55): the reading pane's thread becomes one ordered list of
// messages and TicketAuditEvent rows. Server-rendered and agent-only: no (public) route imports
// this component.
export function ActivityFeed({
  feed,
  references: _references,
  movedFromSources,
  reopenText,
}: {
  feed: FeedItem<TicketDetail["messages"][number], FeedAuditEvent>[];
  references: FeedReferences;
  movedFromSources: Record<string, { id: string; number: number }>;
  /** The existing reopen system-event copy shown after a message that reopened the ticket. */
  reopenText: string;
}) {
  return (
    <ol aria-label="Ticket activity" className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
      {feed.map((item) => {
        if (item.kind === "event") {
          return (
            <li
              key={`event-${item.id}`}
              className="flex items-center justify-center gap-2 py-1 text-center text-[12px] text-muted-foreground"
            >
              {item.event.action}
            </li>
          );
        }
        const message = item.message;
        return (
          <Fragment key={`message-${message.id}`}>
            <li>
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
                movedFrom={
                  message.mergedFromTicketId
                    ? (movedFromSources[message.mergedFromTicketId] ?? null)
                    : null
                }
              />
            </li>
            {/* The reopen marker set on the message itself (never inferred from status). */}
            {message.triggeredReopen && (
              <li>
                <ThreadSystemEvent text={reopenText} />
              </li>
            )}
          </Fragment>
        );
      })}
    </ol>
  );
}
