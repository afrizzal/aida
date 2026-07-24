"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { generateInsightRun } from "./actions";

interface GenerateButtonProps {
  period: 7 | 30 | 90;
  /** True when a PENDING/RUNNING run for this period already exists (server-computed). */
  running: boolean;
}

/**
 * "Generate insights" trigger — useTransition -> Server Action -> toast -> router.refresh.
 * No polling infra (mirrors ReembedAllButton/TriageStatusChip's plain-text in-progress
 * convention): the agent revisits/refreshes to see the COMPLETED result.
 */
export function GenerateButton({ period, running }: GenerateButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await generateInsightRun(period).catch(() => null);
      if (!result?.ok) {
        toast.error("Couldn't start insight generation. Try again.");
        return;
      }
      if (result.alreadyRunning) {
        toast.info("Insights are already generating…");
      }
      router.refresh();
    });
  }

  const busy = isPending || running;

  return (
    <Button type="button" size="sm" disabled={busy} onClick={handleClick}>
      {busy && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
      {busy ? "Generating…" : "Generate insights"}
    </Button>
  );
}
