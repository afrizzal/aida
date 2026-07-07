"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setAiEnabled } from "./actions";

interface AiToggleProps {
  defaultEnabled: boolean;
  /** True once a provider+model (+credential) is saved. Gates the Switch (D-21). */
  providerConfigured: boolean;
}

export function AiToggle({ defaultEnabled, providerConfigured }: AiToggleProps) {
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
        <Switch
          checked={enabled}
          onCheckedChange={handleChange}
          disabled={!providerConfigured}
          aria-label="Enable AI"
        />
        <span className="text-[14px]">Enable AI</span>
      </div>
      {/*
        Gated on provider-config-existing only — deliberately NOT on the last Test Connection
        result (D-21). A persisted test result goes stale the moment a key is revoked or Ollama
        goes down; runtime failures during actual triage calls are handled separately via
        pg-boss retry + a failure badge (D-10). Test Connection stays a manual verification tool,
        never a toggle prerequisite.
      */}
      <p className="text-[12px] text-muted-foreground">
        {providerConfigured
          ? "Allow AIDA to triage tickets and draft replies."
          : "Configure a provider first."}
      </p>
    </div>
  );
}
