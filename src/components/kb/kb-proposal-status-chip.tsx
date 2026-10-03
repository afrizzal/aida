import type { LucideIcon } from "lucide-react";
import { Check, CircleAlert, FileText, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ProposalStatus } from "@/lib/kb/proposal-contract";
import { PROPOSAL_STATUS_LABELS } from "@/lib/kb/proposal-copy";
import { cn } from "@/lib/utils";

const NEUTRAL = "bg-muted text-muted-foreground border border-border";

/**
 * UI-SPEC "Status chip map": one fixed word and its icon per status, never colour alone, token
 * classes only (DESIGN-SYSTEM §2, §4.7). The spinner stops under prefers-reduced-motion.
 */
const CHIP: Record<ProposalStatus, { icon: LucideIcon; iconClassName: string; className: string }> =
  {
    GENERATING: {
      icon: Loader2,
      iconClassName: "size-3 animate-spin motion-reduce:animate-none",
      className: NEUTRAL,
    },
    DRAFT: {
      icon: FileText,
      iconClassName: "size-3",
      className: "bg-primary/10 text-primary-emphasis border border-primary/20",
    },
    REJECTED: { icon: X, iconClassName: "size-3", className: NEUTRAL },
    PUBLISHED: {
      icon: Check,
      iconClassName: "size-3",
      className: "bg-success/10 text-success border border-success/20",
    },
    FAILED: {
      icon: CircleAlert,
      iconClassName: "size-3",
      className: "bg-destructive/10 text-destructive border border-destructive/20",
    },
  };

/** Presentational status chip of a KB proposal (UI-SPEC Color, element E7). */
export function KbProposalStatusChip({ status }: { status: ProposalStatus }) {
  const { icon: Icon, iconClassName, className } = CHIP[status];
  return (
    <Badge className={cn("h-5 gap-1 px-2 py-0.5 text-[12px]", className)}>
      <Icon className={iconClassName} aria-hidden="true" />
      {PROPOSAL_STATUS_LABELS[status]}
    </Badge>
  );
}
