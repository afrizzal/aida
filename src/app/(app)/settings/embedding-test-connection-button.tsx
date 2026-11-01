"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CONNECTION_TEST_ERROR_MESSAGES } from "@/lib/connection-test/errors";
import type { EmbeddingSettingsInput } from "./actions";
import { testEmbeddingConnection } from "./actions";

type Status = "idle" | "testing" | "success" | "failure";

/** Fixed text only: a category message from the shared map, or the thrown-action fallback (D-25). */
interface Failure {
  message: string;
  correlationId?: string;
}

interface EmbeddingTestConnectionButtonProps {
  /** Validates the currently-relevant fields first; resolves null when invalid (inline field errors show instead). */
  getValues: () => Promise<EmbeddingSettingsInput | null>;
}

/**
 * "Test Connection" trigger for the embedding provider form — mirrors LlmTestConnectionButton's
 * 4-state idle/testing/success/failure shape exactly (D-04). The underlying Server Action does a
 * real trivial embed() call so a not-pulled Ollama embedding model fails at Test time (category
 * `connection_failed`, whose fixed text names a missing model as one cause) instead of later
 * during chunk embedding (Pitfall 8). A failure shows the fixed message for its category plus the
 * correlation ID, never raw server text (D-25, K127).
 */
export function EmbeddingTestConnectionButton({ getValues }: EmbeddingTestConnectionButtonProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [failure, setFailure] = useState<Failure | undefined>(undefined);

  async function handleClick() {
    const values = await getValues();
    if (!values) {
      setStatus("idle");
      return;
    }

    setStatus("testing");
    const result = await testEmbeddingConnection(values).catch(() => null);

    if (result?.ok) {
      setStatus("success");
    } else {
      setFailure(
        result
          ? {
              message: CONNECTION_TEST_ERROR_MESSAGES[result.error],
              correlationId: result.correlationId,
            }
          : { message: "Unexpected error — please try again." },
      );
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

        {status === "failure" && failure && (
          <div className="mt-2 flex items-start gap-1.5 text-[12px] text-destructive">
            <XCircle className="mt-0.5 size-3.5 shrink-0" />
            <div>
              <p>Connection failed: {failure.message}</p>
              {failure.correlationId && <p>Reference: {failure.correlationId}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
