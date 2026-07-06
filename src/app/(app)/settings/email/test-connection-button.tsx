"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { EmailSettingsInput } from "./actions";
import { testImapConnection, testSmtpConnection } from "./actions";

type Status = "idle" | "testing" | "success" | "failure";

interface TestConnectionButtonProps {
  kind: "imap" | "smtp";
  getValues: () => EmailSettingsInput;
}

/**
 * Reusable "Test connection" trigger — one instance for IMAP and one for SMTP. The underlying
 * Server Action applies a 10s timeout (Pitfall 5): this button must never spin indefinitely.
 */
export function TestConnectionButton({ kind, getValues }: TestConnectionButtonProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleClick() {
    setStatus("testing");
    const values = getValues();
    const result = await (kind === "imap" ? testImapConnection(values) : testSmtpConnection(values));

    if (result.ok) {
      setStatus("success");
    } else {
      setError(result.error);
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
  );
}
