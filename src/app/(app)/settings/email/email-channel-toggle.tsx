"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setEmailChannelEnabled } from "./actions";

interface EmailChannelToggleProps {
  defaultEnabled: boolean;
}

export function EmailChannelToggle({ defaultEnabled }: EmailChannelToggleProps) {
  const [enabled, setEnabled] = useState(defaultEnabled);

  async function handleChange(next: boolean) {
    // Optimistic UI: update state immediately
    setEnabled(next);

    const result = await setEmailChannelEnabled(next).catch(() => null);

    if (!result?.ok) {
      // Revert on failure and show error toast
      setEnabled(!next);
      toast.error("Failed to update email setting. Please try again.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Switch checked={enabled} onCheckedChange={handleChange} aria-label="Enable email channel" />
        <span className="text-[14px]">Enable email channel</span>
      </div>
      <p className="text-[12px] text-muted-foreground">
        Poll a mailbox for inbound email and send agent replies via SMTP. Off by default until
        configured.
      </p>
    </div>
  );
}
