"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { LlmSettingsInput } from "./actions";
import { testLlmConnection } from "./actions";

type Status = "idle" | "testing" | "success" | "failure";

interface LlmTestConnectionButtonProps {
  /** Validates the currently-relevant fields first; resolves null when invalid (inline field errors show instead). */
  getValues: () => Promise<LlmSettingsInput | null>;
}

/**
 * "Test Connection" trigger for the LLM provider form — mirrors settings/email's
 * TestConnectionButton 4-state idle/testing/success/failure shape exactly (D-04). The underlying
 * Server Action applies a 10s timeout: this button must never spin indefinitely.
 */
export function LlmTestConnectionButton({ getValues }: LlmTestConnectionButtonProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleClick() {
    const values = await getValues();
    if (!values) {
      setStatus("idle");
      return;
    }

    setStatus("testing");
    const result = await testLlmConnection(values).catch(() => ({
      ok: false as const,
      error: "Unexpected error — please try again.",
    }));

    if (result.ok) {
      setStatus("success");
    } else {
      setError(result.error);
      setStatus("failure");
    }
  }

  return (
    <div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={status === "testing"}
        onClick={handleClick}
      >
        {status === "testing" ? (
          <>
            <Loader2 className="mr-2 size-3.5 animate-spin" />
            Testing…
          </>
        ) : (
          "Test connection"
        )}
      </Button>

      {/* Always-mounted live region so screen readers announce the async result when it lands. */}
      <div role="status" aria-live="polite">
        {status === "success" && (
          <div className="mt-2 flex items-center gap-1.5 text-[12px] text-success">
            <CheckCircle2 className="size-3.5" />
            Connected successfully
          </div>
        )}

        {status === "failure" && (
          <div className="mt-2 flex items-center gap-1.5 text-[12px] text-destructive">
            <XCircle className="size-3.5" />
            Connection failed: {error}
          </div>
        )}
      </div>
    </div>
  );
}
