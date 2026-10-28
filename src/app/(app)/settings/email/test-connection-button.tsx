"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CONNECTION_TEST_ERROR_MESSAGES } from "@/lib/connection-test/errors";
import type { EmailSettingsInput } from "./actions";
import { testImapConnection, testSmtpConnection } from "./actions";

type Status = "idle" | "testing" | "success" | "failure";

/** Fixed text only: a category message from the shared map, or the thrown-action fallback (D-25). */
interface Failure {
  message: string;
  correlationId?: string;
}

interface TestConnectionButtonProps {
  kind: "imap" | "smtp";
  /** Validates the section's fields first; resolves null when invalid (field errors show inline). */
  getValues: () => Promise<EmailSettingsInput | null>;
}

/**
 * Reusable "Test connection" trigger — one instance for IMAP and one for SMTP. The underlying
 * Server Action applies a 10s timeout (Pitfall 5): this button must never spin indefinitely. A
 * failure shows the fixed message for its category plus the correlation ID, never raw server text
 * (D-25).
 */
export function TestConnectionButton({ kind, getValues }: TestConnectionButtonProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [failure, setFailure] = useState<Failure | undefined>(undefined);

  async function handleClick() {
    const values = await getValues();
    if (!values) {
      setStatus("idle");
      return;
    }

    setStatus("testing");
    const result = await (kind === "imap"
      ? testImapConnection(values)
      : testSmtpConnection(values)
    ).catch(() => null);

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

  const label = kind === "imap" ? "Test IMAP connection" : "Test SMTP connection";

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
          label
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
