import { stateColorClasses } from "@/lib/tickets/state-colors";
import { cn } from "@/lib/utils";

// UI-SPEC Surface 2: the colour dot inside menu, select and command items. Decoration only; the
// state name next to it is the label.
export function StateDot({ colorToken }: { colorToken: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-2 shrink-0 rounded-full", stateColorClasses(colorToken).dot)}
    />
  );
}
