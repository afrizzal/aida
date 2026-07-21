import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { KbEmbeddingStatus } from "@/generated/prisma/client";

/**
 * Presentational, token-only embedding-status chip for KbArticle rows/detail pages. Mirrors
 * triage-status-chip.tsx's exact visual shape: PENDING is plain muted text (no badge), COMPLETED
 * and FAILED are Badge chips using the success/destructive token families (§4 DESIGN-SYSTEM.md).
 */
export function KbEmbeddingStatusChip({ status }: { status: KbEmbeddingStatus }) {
  if (status === "PENDING") {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Embedding…
      </span>
    );
  }

  if (status === "FAILED") {
    return (
      <Badge className="h-5 px-2 py-0.5 text-[12px] bg-destructive/10 text-destructive border border-destructive/20">
        <CircleAlert className="size-3" />
        Embedding failed
      </Badge>
    );
  }

  return (
    <Badge className="h-5 px-2 py-0.5 text-[12px] bg-success/10 text-success border border-success/20">
      <CircleCheck className="size-3" />
      Indexed
    </Badge>
  );
}
