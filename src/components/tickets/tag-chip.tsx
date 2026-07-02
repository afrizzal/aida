import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function TagChip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <Badge variant="secondary" className="rounded-full">
      {label}
      {onRemove ? (
        <button type="button" aria-label={`Remove tag ${label}`} onClick={onRemove}>
          <X className="size-3" />
        </button>
      ) : null}
    </Badge>
  );
}

export function TagOverflowChip({ count }: { count: number }) {
  return <Badge variant="outline">+{count}</Badge>;
}
