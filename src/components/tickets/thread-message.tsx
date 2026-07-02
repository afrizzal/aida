import { Lock } from "lucide-react";
import { AttachmentChip, formatBytes } from "@/components/tickets/attachment-chip";
import type { MessageVisibility } from "@/generated/prisma/client";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { cn } from "@/lib/utils";

export interface ThreadMessageAttachment {
  id: string;
  originalFilename: string;
  sizeBytes: number;
}

export interface ThreadMessageData {
  id: string;
  visibility: MessageVisibility;
  authorContactId: string | null;
  bodyHtml: string;
  createdAt: Date | string;
  authorUser: { name: string } | null;
  authorContact: { name: string | null; email: string } | null;
  attachments: ThreadMessageAttachment[];
}

/**
 * Chronological thread row — three visual variants (inbound / outbound public reply /
 * internal note). `message.bodyHtml` is the ONLY value ever passed to
 * dangerouslySetInnerHTML — it is pre-sanitized exclusively by renderMarkdown()
 * (src/lib/markdown/render.ts); never render bodyMarkdown raw.
 */
export function ThreadMessage({ message }: { message: ThreadMessageData }) {
  const isInbound = message.authorContactId !== null;
  const isInternal = message.visibility === "INTERNAL";

  const authorName = isInbound
    ? (message.authorContact?.name ?? message.authorContact?.email ?? "Contact")
    : (message.authorUser?.name ?? "Agent");

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border p-3",
        isInbound && "border-border bg-card",
        !isInbound && !isInternal && "border-primary/15 bg-primary/5",
        isInternal && "border-warning/30 border-l-2 border-l-warning bg-warning/10",
      )}
    >
      <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        {isInternal && (
          <>
            <Lock className="size-4 text-warning" />
            <span className="font-medium text-warning uppercase tracking-wide">Internal Note</span>
          </>
        )}
        <span className="font-medium text-foreground">{authorName}</span>
        <span aria-hidden>·</span>
        <span>{formatRelativeTime(message.createdAt)}</span>
      </div>

      <div
        className="text-[14px] text-foreground leading-relaxed"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: bodyHtml is sanitized exclusively by renderMarkdown() — the only permitted call site (src/lib/markdown/render.ts)
        dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
      />

      {message.attachments.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {message.attachments.map((attachment) => (
            <AttachmentChip
              key={attachment.id}
              filename={attachment.originalFilename}
              sizeLabel={formatBytes(attachment.sizeBytes)}
              href={`/api/attachments/${attachment.id}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
