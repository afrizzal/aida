import { Badge } from "@/components/ui/badge";
import { PUBLIC_GROUP_COLOR, STATE_COLORS } from "@/lib/tickets/state-colors";
import { PUBLIC_GROUP_LABELS, type StateGroupKey } from "@/lib/tickets/state-copy";
import { cn } from "@/lib/utils";

// UI-SPEC Surface 6 (D-13): the public status page shows only a fixed label and colour per group.
// The props hold only the group, so no internal state name or colour can reach this component.
type PublicGroupChipProps = { group: StateGroupKey };

export function PublicGroupChip({ group }: PublicGroupChipProps) {
  return (
    <Badge
      className={cn("h-5 px-2 py-0.5 text-[12px]", STATE_COLORS[PUBLIC_GROUP_COLOR[group]].chip)}
    >
      {PUBLIC_GROUP_LABELS[group]}
    </Badge>
  );
}
