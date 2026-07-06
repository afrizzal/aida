"use client";

import { CircleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { retryOutboundSend } from "@/app/(app)/tickets/[id]/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * "Failed to send — Retry" affordance (D-21/03-UI-SPEC Screen Contract 2) — renders only for
 * an outbound public-reply Message whose deliveryStatus is FAILED. Reuses SlaDueChip's exact
 * "Overdue" Badge class string; QUEUED/SENT render nothing (see thread-message.tsx).
 */
export function DeliveryFailedChip({ messageId }: { messageId: string }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    setRetrying(true);
    await retryOutboundSend(messageId);
    router.refresh();
  }

  if (retrying) {
    return <span className="text-[12px] text-muted-foreground">Retrying…</span>;
  }

  return (
    <div className="mt-1.5 flex items-center gap-2">
      <Badge className="h-5 px-2 py-0.5 text-[12px] bg-destructive/10 text-destructive border border-destructive/20">
        <CircleAlert className="size-3" />
        Failed to send
      </Badge>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 text-[12px]"
        onClick={handleRetry}
      >
        Retry
      </Button>
    </div>
  );
}
