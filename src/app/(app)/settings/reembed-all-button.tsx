"use client";

import { Loader2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { reembedAllKb } from "./actions";

interface ReembedAllButtonProps {
  /** Disables the action when there are zero KB articles to re-embed. */
  articleCount: number;
}

/**
 * "Re-embed all KB articles" action — run after changing the embedding provider/model, since
 * vectors from different models are not comparable (Pitfall 5). Re-enqueues EVERY article
 * (never just changed ones) via reembedAllKb -> enqueueReembed.
 */
export function ReembedAllButton({ articleCount }: ReembedAllButtonProps) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await reembedAllKb().catch(() => null);
      if (result?.ok) {
        toast.success(`Re-embedding ${result.count} articles…`);
      } else {
        toast.error("Failed to re-embed KB articles. Please try again.");
      }
    });
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isPending || articleCount === 0}
        onClick={handleClick}
      >
        {isPending && <Loader2 className="mr-2 size-3.5 animate-spin" />}
        Re-embed all KB articles
      </Button>
      <p className="text-[12px] text-muted-foreground">
        Run this after changing the embedding model — vectors from different models are not
        comparable.
      </p>
    </div>
  );
}
