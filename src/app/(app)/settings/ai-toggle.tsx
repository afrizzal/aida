"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setAiEnabled } from "./actions";

interface AiToggleProps {
  defaultEnabled: boolean;
}

export function AiToggle({ defaultEnabled }: AiToggleProps) {
  const [enabled, setEnabled] = useState(defaultEnabled);

  async function handleChange(next: boolean) {
    // Optimistic UI: update state immediately
    setEnabled(next);

    const result = await setAiEnabled(next).catch(() => null);

    if (!result?.ok) {
      // Revert on failure and show error toast
      setEnabled(!next);
      toast.error("Failed to update AI setting. Please try again.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Switch checked={enabled} onCheckedChange={handleChange} aria-label="Enable AI" />
        <span className="text-[14px]">Enable AI</span>
      </div>
      <p className="text-[12px] text-muted-foreground">
        Allow AIDA to triage tickets and draft replies. Configure your AI provider in a future step.
      </p>
    </div>
  );
}
