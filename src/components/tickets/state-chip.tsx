import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { stateColorClasses } from "@/lib/tickets/state-colors";
import { cn } from "@/lib/utils";

// UI-SPEC Surface 2: the chip always shows the state name (colour is never the only signal),
// caps at 160px with truncation and carries the full name in `title`. The Tooltip is added only
// when the host passes `tooltip`, i.e. where the chip is not inside another interactive control.
export function StateChip({
  name,
  colorToken,
  id,
  tooltip = false,
}: {
  name: string;
  colorToken: string;
  id?: string;
  tooltip?: boolean;
}) {
  const chip = (
    <Badge
      id={id}
      title={name}
      className={cn(
        "h-5 max-w-[160px] gap-1 px-2 py-0.5 text-[12px]",
        stateColorClasses(colorToken).chip,
      )}
    >
      <span className="truncate">{name}</span>
    </Badge>
  );

  if (!tooltip) return chip;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{chip}</TooltipTrigger>
        <TooltipContent className="text-[12px]">{name}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
