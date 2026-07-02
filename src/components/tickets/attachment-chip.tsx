import { Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function formatBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  const kb = n / 1024;
  if (kb < 1024) {
    return `${Math.round(kb)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function AttachmentChip({
  filename,
  sizeLabel,
  href,
  onRemove,
}: {
  filename: string;
  sizeLabel: string;
  href?: string;
  onRemove?: () => void;
}) {
  const content = (
    <>
      <Paperclip className="size-3" />
      <span className="truncate">{filename}</span>
      <span className="text-muted-foreground">({sizeLabel})</span>
    </>
  );

  const chipClasses = cn(
    "flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-[12px]",
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={chipClasses}>
        {content}
      </a>
    );
  }

  return (
    <span className={chipClasses}>
      {content}
      {onRemove ? (
        <button type="button" aria-label={`Remove attachment ${filename}`} onClick={onRemove}>
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  );
}
