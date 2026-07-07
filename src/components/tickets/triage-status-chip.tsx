"use client";

import { CircleAlert, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { rerunTriage } from "@/app/(app)/tickets/[id]/actions";
import type { TriageStatus } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Drives the whole triage-status surface off `ticket.triageStatus` (parent renders this only
 * when triageStatus !== null — a never-triaged ticket shows zero triage chrome). Mirrors
 * DeliveryFailedChip's exact client shape (useState + router.refresh + link Button) for the
 * FAILED case (D-10), and calls the existing rerunTriage Server Action (04-05) for D-06.
 */
export function TriageStatusChip({
  ticketId,
  triageStatus,
}: {
  ticketId: string;
  triageStatus: TriageStatus;
}) {
  const router = useRouter();
  const [rerunning, setRerunning] = useState(false);

  async function handleRerun() {
    setRerunning(true);
    const result = await rerunTriage(ticketId).catch(() => null);
    if (!result?.ok) {
      setRerunning(false);
      toast.error("Couldn't re-run triage. Try again.");
      return;
    }
    router.refresh();
  }

  if (rerunning) {
    return <span className="text-[12px] text-muted-foreground">Re-running…</span>;
  }

  if (triageStatus === "PENDING") {
    return <span className="text-[12px] text-muted-foreground">Triaging…</span>;
  }

  if (triageStatus === "FAILED") {
    return (
      <div className="flex items-center gap-2">
        <Badge className="h-5 px-2 py-0.5 text-[12px] bg-destructive/10 text-destructive border border-destructive/20">
          <CircleAlert className="size-3" />
          Triage failed
        </Badge>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-[12px]"
          onClick={handleRerun}
        >
          Re-run
        </Button>
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-6 gap-1.5 px-2 text-[12px]"
      onClick={handleRerun}
    >
      <Sparkles className="size-3.5" />
      Re-run AI triage
    </Button>
  );
}
