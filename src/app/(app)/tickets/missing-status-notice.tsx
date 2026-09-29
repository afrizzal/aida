"use client";

// UI-SPEC Surface 4c (D-09): the inbox URL's status filter names a state that no longer exists
// and no saved-view strip is shown. The missing part matches no ticket; this notice says so and
// offers to remove every missing id. Focus then moves to the Status filter trigger.
import { TriangleAlert } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { parseUrlFilters } from "@/lib/tickets/list-filters";
import { removeDeletedStatusesLabel, URL_MISSING_STATUS_NOTICE } from "@/lib/tickets/state-copy";
import { STATUS_FILTER_TRIGGER_ID } from "./filter-chip-row";

interface MissingStatusNoticeProps {
  /** The state ids in the URL filter that are not active states of the organization. */
  missingIds: string[];
}

export function MissingStatusNotice({ missingIds }: MissingStatusNoticeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function removeMissing() {
    const missing = new Set(missingIds);
    const params = new URLSearchParams(searchParams.toString());
    // The grammar's ids (malformed tokens already became the sentinel, which is missing), so
    // removing the missing ids leaves only active ids, already sorted (D-09 URL contract).
    const kept = parseUrlFilters(searchParams).filters.stateIds.filter((id) => !missing.has(id));
    if (kept.length > 0) params.set("state", kept.join(","));
    else params.delete("state");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
    document.getElementById(STATUS_FILTER_TRIGGER_ID)?.focus();
  }

  return (
    <div
      role="status"
      className="mx-4 my-2 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-4 text-[13px] text-foreground"
    >
      <TriangleAlert aria-hidden className="size-4 shrink-0 text-warning" />
      <div className="min-w-0 space-y-2">
        <p>{URL_MISSING_STATUS_NOTICE}</p>
        <Button variant="outline" size="sm" className="text-[13px]" onClick={removeMissing}>
          {removeDeletedStatusesLabel(missingIds.length)}
        </Button>
      </div>
    </div>
  );
}
